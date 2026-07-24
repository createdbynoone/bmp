import { app, BrowserWindow, ipcMain, shell, nativeImage, protocol, net, Menu, dialog, screen } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, createWriteStream, renameSync, mkdirSync, readdirSync, unlinkSync, rmdirSync } from 'fs'
import { homedir } from 'os'
import { execFile, exec } from 'child_process'
import { promisify } from 'util'
import { scryptSync, timingSafeEqual } from 'crypto'
import https from 'https'
import Anthropic from '@anthropic-ai/sdk'
import electronUpdater from 'electron-updater'
const { autoUpdater } = electronUpdater

// ─── RAM footprint ──────────────────────────────────────────────────────────
// BMP is a form + a couple of tabs — no canvas, no <video>, no WebGL anywhere
// in the renderer, so the GPU/compositor process buys nothing here. Dropping
// it removes an entire Chromium process (~60-100MB RSS) with zero visual or
// functional change. Must run before app is ready.
app.disableHardwareAcceleration()
// Chromium's own background services (Safe Browsing pings, component/variations
// updates, media session discovery) — irrelevant to a local tool, not used by
// any app feature, safe to strip. Does not touch our own fetch() calls to
// Anthropic/POYO, which the main process makes directly on demand.
app.commandLine.appendSwitch('disable-background-networking')
app.commandLine.appendSwitch('disable-features', 'MediaRouter,OptimizationGuideModelDownloading,Translate')

// ─── Preferences ──────────────────────────────────────────────────────────────

const ICON_STYLES = ['Default', 'Dark', 'ClearLight', 'ClearDark', 'TintedLight', 'TintedDark'] as const
type IconStyle = typeof ICON_STYLES[number]

interface Prefs {
  iconStyle: IconStyle
  outputPath: string
  unlockedAt?: string
  authFailCount?: number
  authLockUntil?: number
}

function prefsPath(): string {
  return join(app.getPath('userData'), 'bmp-prefs.json')
}

function defaultOutputPath(): string {
  return join(homedir(), 'Desktop')
}

function loadPrefs(): Prefs {
  try {
    const raw = readFileSync(prefsPath(), 'utf-8')
    return { iconStyle: 'Default', outputPath: defaultOutputPath(), ...JSON.parse(raw) }
  } catch {
    return { iconStyle: 'Default', outputPath: defaultOutputPath() }
  }
}

function savePrefs(prefs: Prefs) {
  writeFileSync(prefsPath(), JSON.stringify(prefs, null, 2), 'utf-8')
}

// ─── App lock ─────────────────────────────────────────────────────────────────
// Only the scrypt hash + salt live here — the passphrase itself is never
// written to source or to the compiled bundle, so reading/decompiling the app
// cannot recover it directly (only an offline brute-force against the hash).
const LOCK_SALT_HEX = '7676d27c96570e2c9bcb3a2efc95ea06'
const LOCK_HASH_HEX = '269de1a03844d8db8f8b154038a158a44bf19b79e309b6eb2c7c7ecf1db6e2b687dc6f34b9a107cebe3f224260b1b58c67324f54be47f0766cc938a1bac8ad31'
const LOCK_HASH = Buffer.from(LOCK_HASH_HEX, 'hex')

let unlocked = false

function verifyPassphrase(attempt: string): boolean {
  const candidate = scryptSync(attempt, Buffer.from(LOCK_SALT_HEX, 'hex'), 64)
  return candidate.length === LOCK_HASH.length && timingSafeEqual(candidate, LOCK_HASH)
}

// Failed attempts + lockout persist across restarts (in prefs) so quitting
// and relaunching the app can't be used to reset a brute-force cooldown.
function currentLockout(): number {
  return loadPrefs().authLockUntil ?? 0
}

function registerFailedAttempt(): number {
  const prefs = loadPrefs()
  const count = (prefs.authFailCount ?? 0) + 1
  // Exponential backoff after the 3rd bad attempt: 5s, 10s, 20s, 40s ... capped at 5min
  const lockUntil = count >= 3
    ? Date.now() + Math.min(5000 * 2 ** (count - 3), 5 * 60 * 1000)
    : 0
  savePrefs({ ...prefs, authFailCount: count, authLockUntil: lockUntil })
  return lockUntil
}

function clearAuthState(): void {
  const prefs = loadPrefs()
  savePrefs({ ...prefs, authFailCount: 0, authLockUntil: 0, unlockedAt: new Date().toISOString() })
}

function requireUnlocked(): void {
  if (!unlocked) throw new Error('Locked')
}

// Every handler below requires the passphrase to have been entered once on
// this machine — without this, a renderer that skips the LockScreen UI
// (e.g. via devtools) still can't reach the filesystem or the Anthropic/POYO keys.
function handleWhenUnlocked<Args extends unknown[], R>(
  channel: string,
  fn: (event: Electron.IpcMainInvokeEvent, ...args: Args) => R,
): void {
  ipcMain.handle(channel, (event, ...args: Args) => {
    requireUnlocked()
    return fn(event, ...args)
  })
}

ipcMain.handle('auth:status', () => ({
  locked: !unlocked,
  lockUntil: currentLockout(),
}))

ipcMain.handle('auth:unlock', (_e, attempt: unknown) => {
  const lockUntil = currentLockout()
  if (Date.now() < lockUntil) return { ok: false, lockUntil }
  if (typeof attempt !== 'string' || !verifyPassphrase(attempt)) {
    return { ok: false, lockUntil: registerFailedAttempt() }
  }
  clearAuthState()
  unlocked = true
  return { ok: true, lockUntil: 0 }
})

// Paths the renderer is legitimately allowed to preview via localfile:// —
// resolved from a real Finder drag (preload's getPathForFile wrapper
// registers it here). Without this the protocol handler below would serve
// ANY path on disk with no restriction.
const knownLocalPaths = new Set<string>()
ipcMain.on('register-known-path', (event, path: unknown) => {
  if (typeof path === 'string' && path) knownLocalPaths.add(path)
  event.returnValue = true
})

function getIconPath(styleName: string): string {
  const filename = `Icon-macOS-${styleName}-1024@1x.png`
  if (app.isPackaged) return join(process.resourcesPath, 'icons', filename)
  return join(__dirname, '../../build/icons', filename)
}

function applyDockIcon(styleName: string) {
  if (process.platform !== 'darwin') return
  try {
    const icon = nativeImage.createFromPath(getIconPath(styleName))
    if (!icon.isEmpty()) app.dock?.setIcon(icon)
  } catch {}
}

function buildAppMenu() {
  const prefs = loadPrefs()

  const iconSubmenu: Electron.MenuItemConstructorOptions[] = ICON_STYLES.map(style => ({
    label: style,
    type: 'radio' as const,
    checked: prefs.iconStyle === style,
    click: () => {
      savePrefs({ ...loadPrefs(), iconStyle: style })
      applyDockIcon(style)
      buildAppMenu()
    },
  }))

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.getName(),
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'App Icon', submenu: iconSubmenu },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ─── Prompt Memory ────────────────────────────────────────────────────────────

interface MemoryEntry {
  id: string
  timestamp: number
  description: string
  prompt: string
  fired: boolean
  aspectRatio?: string
}

interface Memory {
  entries: MemoryEntry[]
}

function memoryPath(): string {
  return join(app.getPath('userData'), 'bmp-memory.json')
}

function loadMemory(): Memory {
  try {
    const raw = readFileSync(memoryPath(), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return { entries: [] }
  }
}

function saveMemory(memory: Memory) {
  writeFileSync(memoryPath(), JSON.stringify(memory, null, 2), 'utf-8')
}

function addMemoryEntry(entry: Omit<MemoryEntry, 'id'>): MemoryEntry {
  const memory = loadMemory()
  const newEntry: MemoryEntry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ...entry }
  memory.entries.push(newEntry)
  // Keep last 200 entries
  if (memory.entries.length > 200) memory.entries = memory.entries.slice(-200)
  saveMemory(memory)
  return newEntry
}

function markFired(id: string, aspectRatio: string) {
  const memory = loadMemory()
  const entry = memory.entries.find(e => e.id === id)
  if (entry) { entry.fired = true; entry.aspectRatio = aspectRatio }
  saveMemory(memory)
}

// Build dynamic memory context to inject into system prompt
function buildMemoryContext(): string {
  const memory = loadMemory()
  if (memory.entries.length === 0) return ''

  // Prioritize fired prompts (real signal), then recent ones
  const fired = memory.entries.filter(e => e.fired).slice(-8)
  const recent = memory.entries.filter(e => !e.fired).slice(-5)
  const pool = [...fired, ...recent].sort((a, b) => a.timestamp - b.timestamp)

  if (pool.length === 0) return ''

  const lines = pool.map(e => {
    const label = e.fired ? '★ FIRED' : '○ generated'
    const date = new Date(e.timestamp).toLocaleDateString('es-CO', { month: 'short', day: 'numeric' })
    return `[${label} · ${date}]\nBrief: "${e.description}"\nPrompt:\n${e.prompt}`
  }).join('\n\n---\n\n')

  return `\n\n## PROMPT MEMORY — ${pool.length} past Brotherhood prompts (★ = approved & fired to Higgsfield)\nStudy these to calibrate vocabulary, light descriptions, garment detail depth, color language, and brand tone. Fired prompts are your strongest signal — replicate what makes them work.\n\n${lines}\n\n---\nApply learnings silently. Output ONLY the new prompt.`
}

const execFileAsync = promisify(execFile)
const execAsync = promisify(exec)

// Electron doesn't inherit the shell PATH — resolve common binary locations manually
const SHELL_PATH = [
  '/usr/local/bin',
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/usr/bin',
  '/bin',
  process.env.PATH ?? '',
].join(':')

function shellEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: SHELL_PATH }
}

// Load .env — checks multiple locations so packaged app can find it
function loadEnv() {
  const candidates = [
    join(homedir(), '.bmp.env'),
    app.isPackaged
      ? join(process.resourcesPath, '.env')
      : join(__dirname, '../../.env'),
  ]
  for (const envPath of candidates) {
    try {
      const raw = readFileSync(envPath, 'utf-8')
      for (const line of raw.split('\n')) {
        const [key, ...rest] = line.split('=')
        if (key && rest.length) process.env[key.trim()] = rest.join('=').trim()
      }
      break
    } catch {}
  }
}

loadEnv()

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const CLAUDE_MODEL = 'claude-sonnet-5'

const SYSTEM_PROMPT = `You are a specialist in generating NanaBanana2 (Higgsfield) prompts for Brotherhood streetwear marketing/editorial photography. Brotherhood is a Colombian streetwear brand with a bold, authentic aesthetic.

Your prompts follow this exact structure:

[SCENE]: [Setting with specific visual context]

[GARMENT]: Brotherhood [garment type] in [color (#hex)] — [key graphic description: placement, scale, technique]. [Construction details if visible].

[PLACEMENT/INTERACTION]: [How the garment exists in the scene]

[COMPOSITION]: [Angle and framing]

[LIGHTING]: [Natural light quality and characteristics]

[CAMERA]: Shot on Sony A7R IV, [lens]. [Aesthetic quality].

[MOOD]: [Color grade description]

Ultra-realistic commercial fashion editorial photography. Photojournalistic authenticity. Every garment fiber, print texture, and construction detail rendered in sharp focus. Campaign-quality production value. Brotherhood brand identity preserved exactly.

Rules:
- Never leave bracketed placeholders empty — always fill with specific, visual language
- Be extremely specific about light direction, color temperatures, surface textures
- The garment must be clearly identifiable — color, graphics, and construction details preserved faithfully
- Think like a fashion photographer: environment, light, angle, and garment interaction are the four pillars
- Marketing/editorial style — NOT e-commerce (no white background, no invisible mannequin)
- Output ONLY the prompt text, no preamble or explanation

HIGGSFIELD CONTENT SAFETY — violations cause silent generation failure with no image output:
- Describe body only in relation to garment fit and drape — never as a primary subject
- No weapons, blood, violence, drugs, political symbols, or explicit anatomy of any kind
- No other real brand names or logos — Brotherhood/BRHD only
- Settings must be public, commercial, or natural spaces — avoid private or intimate interiors
- Avoid overly dark or threatening atmosphere — keep tone aspirational and editorial
- Do not reference real public figures, celebrities, or identifiable faces
- If a graphic on the garment contains text, describe its visual style only (e.g. "gothic serif lettering") — do not reproduce the exact words if they could be flagged
- Keep lighting descriptions neutral — avoid "harsh shadows" on faces, "low-key" alone, or any wording that sounds like surveillance/threat context`

const MAX_IMAGE_PX = 1568 // Anthropic recommended max dimension

function resizeAndEncode(p: string): { b64: string; mediaType: Anthropic.Base64ImageSource['media_type'] } | null {
  try {
    const img = nativeImage.createFromPath(p)
    if (!img.isEmpty()) {
      const { width, height } = img.getSize()
      const scale = Math.min(1, MAX_IMAGE_PX / Math.max(width, height))
      const resized = scale < 1
        ? img.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'good' })
        : img
      const b64 = resized.toJPEG(85).toString('base64')
      if (b64) return { b64, mediaType: 'image/jpeg' }
    }
    // Fallback: read raw bytes and detect media type from extension
    const raw = readFileSync(p)
    const ext = p.split('.').pop()?.toLowerCase() ?? ''
    const mediaType: Anthropic.Base64ImageSource['media_type'] =
      ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
    const b64 = raw.toString('base64')
    if (!b64) return null
    return { b64, mediaType }
  } catch {
    return null
  }
}

function filesToVisionContent(paths: string[]): Anthropic.ImageBlockParam[] {
  return paths
    .map((p) => resizeAndEncode(p))
    .filter((r): r is NonNullable<typeof r> => r !== null && r.b64.length > 0)
    .map(({ b64, mediaType }) => ({
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: mediaType, data: b64 },
    }))
}

const GENERATE_COOLDOWN_MS = 4000
let lastGenerateTime = 0

handleWhenUnlocked('generate-prompt', async (_event, { refs, products, description }: { refs: string[]; products: string[]; description: string }) => {
  const now = Date.now()
  if (now - lastGenerateTime < GENERATE_COOLDOWN_MS) {
    const wait = Math.ceil((GENERATE_COOLDOWN_MS - (now - lastGenerateTime)) / 1000)
    throw new Error(`Rate limit: wait ${wait}s before generating again`)
  }
  lastGenerateTime = now

  if (typeof description !== 'string' || description.trim().length === 0 || description.length > 2000) {
    throw new Error('Invalid description')
  }
  if (!Array.isArray(refs) || !Array.isArray(products) || refs.length > 30 || products.length > 30) {
    throw new Error('Invalid file input')
  }

  const refImages = filesToVisionContent(refs)
  const productImages = filesToVisionContent(products)

  // Inject accumulated memory into system prompt
  const systemWithMemory = SYSTEM_PROMPT + buildMemoryContext()

  const userContent: Anthropic.MessageParam['content'] = [
    { type: 'text', text: '## REFERENCE IMAGES (composition/mood):' },
    ...refImages,
    { type: 'text', text: '## PRODUCT PHOTOS (Brotherhood garment):' },
    ...productImages,
    {
      type: 'text',
      text: `## USER BRIEF:\n${description}\n\nGenerate the NanaBanana2 marketing prompt now.`,
    },
  ]

  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system: systemWithMemory,
    messages: [{ role: 'user', content: userContent }],
  })

  const block = message.content[0]
  if (block.type !== 'text') throw new Error('Unexpected response type')
  const prompt = block.text

  // Save to memory
  const entry = addMemoryEntry({ timestamp: Date.now(), description, prompt, fired: false })

  return { prompt, memoryId: entry.id }
})

handleWhenUnlocked('mark-prompt-fired', (_event, { id, aspectRatio }: { id: string; aspectRatio: string }) => {
  markFired(id, aspectRatio)
})

handleWhenUnlocked('get-version', () => app.getVersion())

handleWhenUnlocked('get-output-path', () => loadPrefs().outputPath)

handleWhenUnlocked('set-output-path', (_event, path: string) => {
  if (typeof path !== 'string' || path.length === 0) throw new Error('Invalid path')
  savePrefs({ ...loadPrefs(), outputPath: path })
})

handleWhenUnlocked('open-folder-dialog', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    title: 'Choose output folder',
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

handleWhenUnlocked('get-memory-stats', () => {
  const memory = loadMemory()
  return {
    total: memory.entries.length,
    fired: memory.entries.filter(e => e.fired).length,
  }
})

handleWhenUnlocked('get-memory-entries', () => {
  const memory = loadMemory()
  return [...memory.entries].reverse()
})

handleWhenUnlocked('check-higgsfield-auth', async () => {
  return { authenticated: !!process.env.POYO_API_KEY }
})

handleWhenUnlocked('higgsfield-login', async () => {
  return { ok: false, error: 'Add POYO_API_KEY to ~/.bmp.env' }
})

function downloadFile(url: string, destPath: string): Promise<void> {
  if (!url.startsWith('https://')) return Promise.reject(new Error('Only HTTPS downloads are allowed'))
  return new Promise((resolve, reject) => {
    const file = createWriteStream(destPath)
    https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close()
        downloadFile(res.headers.location, destPath).then(resolve).catch(reject)
        return
      }
      res.pipe(file)
      file.on('finish', () => file.close(() => resolve()))
      file.on('error', reject)
    }).on('error', reject)
  })
}

function downloadDmgWithProgress(
  url: string,
  destPath: string,
  token: string | undefined,
  onProgress: (percent: number) => void,
): Promise<void> {
  if (!url.startsWith('https://')) return Promise.reject(new Error('Only HTTPS downloads are allowed'))
  return new Promise((resolve, reject) => {
    const attempt = (attemptUrl: string) => {
      if (!attemptUrl.startsWith('https://')) {
        reject(new Error('Redirect to non-HTTPS blocked'))
        return
      }
      const parsed = new URL(attemptUrl)
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}

      https.get({ hostname: parsed.hostname, path: parsed.pathname + parsed.search, headers }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          attempt(res.headers.location)
          return
        }
        const total = parseInt(res.headers['content-length'] ?? '0', 10)
        let received = 0
        const file = createWriteStream(destPath)
        res.on('data', (chunk: Buffer) => {
          received += chunk.length
          if (total > 0) onProgress(Math.round((received / total) * 100))
        })
        res.pipe(file)
        file.on('finish', () => file.close(() => resolve()))
        file.on('error', reject)
      }).on('error', reject)
    }
    attempt(url)
  })
}

handleWhenUnlocked('get-higgsfield-credits', async () => {
  return { credits: null, plan: 'nano-banana-2' }
})

// ── POYO.ai shared utilities ───────────────────────────────────────────────────

const MAX_FRAME_PX = 1280

async function uploadFrameToPOYO(filePath: string, apiKey: string, index: number): Promise<string> {
  // Resize frame before upload to reduce payload size
  let b64: string
  try {
    const img = nativeImage.createFromPath(filePath)
    if (!img.isEmpty()) {
      const { width, height } = img.getSize()
      const scale = Math.min(1, MAX_FRAME_PX / Math.max(width, height))
      const resized = scale < 1
        ? img.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'best' })
        : img
      b64 = resized.toJPEG(90).toString('base64')
    } else {
      b64 = readFileSync(filePath).toString('base64')
    }
  } catch {
    b64 = readFileSync(filePath).toString('base64')
  }

  const fileName = `frame_${index + 1}_${Date.now()}.jpg`
  const res = await fetch('https://api.poyo.ai/api/common/upload/base64', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64_data: b64, file_name: fileName }),
  })
  const data = await res.json() as { success?: boolean; data?: { file_url: string }; error?: { message: string } }
  if (!data.success || !data.data?.file_url) throw new Error(data.error?.message ?? 'Upload failed')
  return data.data.file_url
}

// Upload multiple files in parallel, preserving order (critical for @Image index alignment)
async function uploadFilesToPOYO(filePaths: string[], apiKey: string, sendProgress: (l: string) => void): Promise<string[]> {
  if (filePaths.length === 0) return []
  sendProgress(`Uploading ${filePaths.length} image${filePaths.length > 1 ? 's' : ''} to POYO...`)
  const results = await Promise.allSettled(filePaths.map((f, i) => uploadFrameToPOYO(f, apiKey, i)))
  const failures = results.filter((r) => r.status === 'rejected')
  if (failures.length > 0) {
    const err = (failures[0] as PromiseRejectedResult).reason
    throw new Error(`Upload failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  sendProgress(`${filePaths.length} image${filePaths.length > 1 ? 's' : ''} uploaded ✓`)
  return results.map((r) => (r as PromiseFulfilledResult<string>).value)
}

// Shared POYO task poller
async function pollPOYOTask(
  taskId: string, apiKey: string,
  sendProgress: (l: string) => void
): Promise<Array<{ file_url: string; file_type: string }>> {
  await new Promise((r) => setTimeout(r, 8000))
  let lastStatus = ''; let lastPct = -1
  const startTs = Date.now()
  for (let i = 0; i < 120; i++) {
    const res = await fetch(`https://api.poyo.ai/api/generate/status/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    const d = await res.json() as { data?: { status: string; progress?: number; files?: Array<{ file_url: string; file_type: string }>; error_message?: string }; error?: { message: string } }
    const task = d.data
    if (!task) { sendProgress(`Poll error: ${d.error?.message ?? 'no data'}`); await new Promise((r) => setTimeout(r, 5000)); continue }
    const pct = task.progress ?? 0
    const elapsed = Math.round((Date.now() - startTs) / 1000)
    if (task.status !== lastStatus || pct !== lastPct) {
      sendProgress(`${task.status}${pct > 0 ? ` ${pct}%` : ''} · ${elapsed}s`)
      lastStatus = task.status; lastPct = pct
    }
    if (['finished', 'completed', 'succeeded'].includes(task.status)) return task.files ?? []
    if (['failed', 'error'].includes(task.status)) {
      throw new Error(task.error_message ? `POYO: ${task.error_message}` : `Generation ${task.status}`)
    }
    await new Promise((r) => setTimeout(r, 5000))
  }
  throw new Error('Timeout — task exceeded 10 minutes')
}

// ── POYO.ai image generation — Seedream 5.0 Pro / Nano Banana Pro ──────────────

const IMAGE_RATIOS = ['4:5', '9:16'] as const
// Model tab (fire-model, NB2/Recraft) keeps the full ratio set — unaffected by
// the Image tab's 4:5/9:16-only restriction above
const MODEL_RATIOS = ['9:16', '4:5', '1:1', '16:9'] as const
const POYO_MAX_REFS = 14 // POYO hard limit: 14 reference images per request

// Per-provider model slugs and resolution ceiling — Seedream 5.0 Pro on POYO
// only exposes 1K/2K, Nano Banana Pro goes up to native 4K
const IMAGE_PROVIDERS = {
  seedream: { model: 'seedream-5.0-pro', editModel: 'seedream-5.0-pro-edit', resolutions: ['1k', '2k'] },
  nanobanana: { model: 'nano-banana-pro', editModel: 'nano-banana-pro-edit', resolutions: ['1k', '2k', '4k'] },
} as const
type ImageProvider = keyof typeof IMAGE_PROVIDERS

// Upload product refs once and return their POYO URLs — used to fan out multiple
// generations (variations) without re-uploading the same images per task
handleWhenUnlocked('upload-poyo-refs', async (event, { products }: { products: string[] }) => {
  if (!Array.isArray(products)) throw new Error('Invalid products')

  const apiKey = process.env.POYO_API_KEY
  if (!apiKey) throw new Error('POYO_API_KEY not set — add it to ~/.bmp.env')

  const sendProgress = (line: string) => event.sender.send('higgsfield-progress', { scope: 'image', line })
  let files = products
  if (files.length > POYO_MAX_REFS) {
    sendProgress(`POYO accepts max ${POYO_MAX_REFS} reference images — using the first ${POYO_MAX_REFS}`)
    files = files.slice(0, POYO_MAX_REFS)
  }
  const urls = await uploadFilesToPOYO(files, apiKey, sendProgress)
  return { urls }
})

handleWhenUnlocked('fire-poyo-image', async (event, { prompt, products, aspectRatio, resolution, provider, imageUrls: presetUrls }: {
  prompt: string; products: string[]; aspectRatio: string; resolution: string; provider?: string; imageUrls?: string[]
}) => {
  if (typeof prompt !== 'string' || prompt.trim().length === 0) throw new Error('Invalid prompt')
  if (!Array.isArray(products)) throw new Error('Invalid products')
  if (presetUrls !== undefined && (!Array.isArray(presetUrls) || presetUrls.some((u) => typeof u !== 'string'))) throw new Error('Invalid imageUrls')

  const apiKey = process.env.POYO_API_KEY
  if (!apiKey) throw new Error('POYO_API_KEY not set — add it to ~/.bmp.env')

  const providerKey: ImageProvider = provider === 'seedream' ? 'seedream' : 'nanobanana'
  const providerCfg = IMAGE_PROVIDERS[providerKey]

  const timestamp = Date.now()
  const desktopPath = loadPrefs().outputPath
  const sendProgress = (line: string) => event.sender.send('higgsfield-progress', { scope: 'image', line })
  const safeSize = IMAGE_RATIOS.includes(aspectRatio as typeof IMAGE_RATIOS[number]) ? aspectRatio : '4:5'
  const allowedResolutions: readonly string[] = providerCfg.resolutions
  const safeRes = (allowedResolutions.includes(resolution) ? resolution : allowedResolutions[allowedResolutions.length - 1]).toUpperCase()

  // Use pre-uploaded reference URLs when provided; otherwise upload now (max 14)
  let imageUrls: string[] = (presetUrls ?? []).slice(0, POYO_MAX_REFS)
  if (imageUrls.length === 0 && products.length > 0) {
    let files = products
    if (files.length > POYO_MAX_REFS) {
      sendProgress(`POYO accepts max ${POYO_MAX_REFS} reference images — using the first ${POYO_MAX_REFS}`)
      files = files.slice(0, POYO_MAX_REFS)
    }
    try {
      imageUrls = await uploadFilesToPOYO(files, apiKey, sendProgress)
    } catch (err) {
      sendProgress(err instanceof Error ? err.message : String(err))
      return { success: false, outputPath: '', error: String(err) }
    }
  }

  // Use edit model when product images provided (better adherence to reference)
  const model = imageUrls.length > 0 ? providerCfg.editModel : providerCfg.model
  const input: Record<string, unknown> = { prompt, size: safeSize, resolution: safeRes }
  if (imageUrls.length > 0) input.image_urls = imageUrls

  sendProgress(`Submitting ${model} (${safeSize} · ${safeRes})...`)

  const submitRes = await fetch('https://api.poyo.ai/api/generate/submit', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input }),
  })
  const submitData = await submitRes.json() as { code?: number; data?: { task_id: string }; error?: { message: string } }
  if (!submitRes.ok || !submitData.data?.task_id) {
    const msg = submitData.error?.message ?? `HTTP ${submitRes.status}`
    sendProgress(`Submit error: ${msg}`)
    return { success: false, outputPath: '', error: msg }
  }

  sendProgress(`Generating... (${submitData.data.task_id})`)

  try {
    const files = await pollPOYOTask(submitData.data.task_id, apiKey, sendProgress)
    const imgFile = files.find((f) => f.file_type === 'image' || f.file_url.match(/\.(jpg|jpeg|png|webp)/i))
    if (!imgFile) { sendProgress('No image in response'); return { success: false, outputPath: '', error: 'No image file' } }
    const ext = imgFile.file_url.split('.').pop()?.split('?')[0] ?? 'jpg'
    const outputName = `bmp_${timestamp}.${ext}`
    const outputPath = join(desktopPath, outputName)
    sendProgress('Downloading image...')
    await downloadFile(imgFile.file_url, outputPath)
    knownLocalPaths.add(outputPath) // allow the renderer to preview the result
    try {
      const { stdout } = await execFileAsync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', outputPath])
      const w = stdout.match(/pixelWidth:\s*(\d+)/)?.[1]; const h = stdout.match(/pixelHeight:\s*(\d+)/)?.[1]
      sendProgress(`Saved: ${outputName}${w && h ? ` · ${w}×${h}px` : ''}`)
    } catch { sendProgress(`Saved: ${outputName}`) }
    return { success: true, outputPath }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    sendProgress(`Error: ${msg}`)
    return { success: false, outputPath: '', error: msg }
  }
})

// ── Model tab — AI model creation: SKU folders + auto macro face shot ──────────

const MODELS_DIR = '/Volumes/Sandisk Home/Brotherhood/IA/Modelos'

// Recraft v4.1 Pro (4MP) supported sizes, mapped from the app's aspect ratios
const RECRAFT_SIZES: Record<string, string> = {
  '9:16': '1536x2688',
  '4:5': '1792x2304',
  '1:1': '2048x2048',
  '16:9': '2688x1536',
}

// Preset macro prompt for the automatic face shot — gender-neutral, anchored to
// the reference image so nano-banana-2-edit preserves the generated identity
const MACRO_FACE_PROMPT = `Macro beauty close-up of the EXACT same person from the reference image — preserve identical facial features, bone structure, skin tone, eye color, eyebrows, hairstyle and any visible styling exactly as shown. Tight portrait framing from forehead to chin filling the frame, face centered, eyes locked direct to lens in razor-sharp focus. Ultra-detailed natural skin texture: visible pores, fine vellus hair, natural micro-imperfections and subtle sheen — no airbrushing. Individual eyelashes and brow hairs resolved, natural lip texture. Soft wraparound beauty-dish light with clean catchlights in both eyes, gentle falloff, seamless neutral studio backdrop dissolving out of focus. Shot on Sony A7R IV, 90mm macro lens at f/4, shallow depth of field. Ultra-realistic commercial beauty campaign photography.`

// SKUs held by in-flight generations — a folder scan alone would let two
// parallel fires allocate the same number
const reservedSkus = new Set<string>()

function allocateSku(gender: 'female' | 'male'): { sku: string; dir: string } {
  const prefix = gender === 'male' ? 'SMM' : 'SMF'
  const genderDir = join(MODELS_DIR, prefix)
  mkdirSync(genderDir, { recursive: true })
  const rx = new RegExp(`^${prefix}(\\d{3,})$`)
  const used = readdirSync(genderDir)
    .map((n) => n.match(rx)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number)
  for (const s of reservedSkus) {
    const m = s.match(rx)
    if (m) used.push(Number(m[1]))
  }
  const sku = `${prefix}${String((used.length > 0 ? Math.max(...used) : 0) + 1).padStart(3, '0')}`
  reservedSkus.add(sku)
  const dir = join(genderDir, sku)
  mkdirSync(dir, { recursive: true })
  return { sku, dir }
}

function sniffImageExt(path: string): string {
  const head = readFileSync(path).subarray(0, 4)
  return head.toString('latin1') === 'RIFF' ? 'webp'
    : head[0] === 0x89 && head[1] === 0x50 ? 'png'
    : head[0] === 0xff && head[1] === 0xd8 ? 'jpg'
    : 'png'
}

async function sendSavedLine(outputPath: string, sendProgress: (l: string) => void) {
  const name = outputPath.split('/').pop() ?? outputPath
  try {
    const { stdout } = await execFileAsync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', outputPath])
    const w = stdout.match(/pixelWidth:\s*(\d+)/)?.[1]; const h = stdout.match(/pixelHeight:\s*(\d+)/)?.[1]
    sendProgress(`Saved: ${name}${w && h ? ` · ${w}×${h}px` : ''}`)
  } catch { sendProgress(`Saved: ${name}`) }
}

// Generate with Recraft v4.1 Pro and save as destDir/baseName.<ext>. Throws on failure.
async function recraftGenerateToFile(prompt: string, aspectRatio: string, destDir: string, baseName: string, sendProgress: (l: string) => void): Promise<string> {
  const apiKey = process.env.RECRAFT_API_KEY
  if (!apiKey) throw new Error('RECRAFT_API_KEY not set — add it to ~/.bmp.env')
  const size = RECRAFT_SIZES[aspectRatio] ?? RECRAFT_SIZES['4:5']

  sendProgress(`Submitting Recraft v4.1 Pro (${aspectRatio} · ${size})...`)
  const res = await fetch('https://external.api.recraft.ai/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    // No `style` param — Recraft v4.1 Pro rejects it ("doesn't support style
    // 'realistic_image'"); the model's default is already photorealistic
    body: JSON.stringify({ prompt, model: 'recraftv4_1_pro', n: 1, size, response_format: 'url' }),
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const errBody = await res.json() as { message?: string; error?: { message?: string } }
      msg = errBody.error?.message ?? errBody.message ?? msg
    } catch {}
    throw new Error(msg)
  }
  const data = await res.json() as { data?: Array<{ url?: string }> }
  const imageUrl = data.data?.[0]?.url
  if (!imageUrl) throw new Error('No image URL in Recraft response')

  sendProgress('Downloading image...')
  // Recraft URLs carry no file extension — download first, then sniff the
  // magic bytes for the real format (v4.1 Pro currently serves WebP)
  const tmpPath = join(destDir, `${baseName}.download`)
  await downloadFile(imageUrl, tmpPath)
  const outputPath = join(destDir, `${baseName}.${sniffImageExt(tmpPath)}`)
  renameSync(tmpPath, outputPath)
  knownLocalPaths.add(outputPath) // allow the renderer to preview the result
  await sendSavedLine(outputPath, sendProgress)
  return outputPath
}

// Submit a POYO generation, poll it, and save the image as destDir/baseName.<ext>. Throws on failure.
async function poyoGenerateToFile(opts: {
  model: string; input: Record<string, unknown>; apiKey: string
  destDir: string; baseName: string; sendProgress: (l: string) => void
}): Promise<string> {
  const { model, input, apiKey, destDir, baseName, sendProgress } = opts
  const submitRes = await fetch('https://api.poyo.ai/api/generate/submit', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input }),
  })
  const submitData = await submitRes.json() as { data?: { task_id: string }; error?: { message: string } }
  if (!submitRes.ok || !submitData.data?.task_id) {
    throw new Error(submitData.error?.message ?? `HTTP ${submitRes.status}`)
  }
  sendProgress(`Generating... (${submitData.data.task_id})`)

  const files = await pollPOYOTask(submitData.data.task_id, apiKey, sendProgress)
  const imgFile = files.find((f) => f.file_type === 'image' || f.file_url.match(/\.(jpg|jpeg|png|webp)/i))
  if (!imgFile) throw new Error('No image file in response')
  const urlExt = imgFile.file_url.split('.').pop()?.split('?')[0]?.toLowerCase()
  const ext = urlExt && urlExt.length <= 4 ? urlExt : 'jpg'
  const outputPath = join(destDir, `${baseName}.${ext}`)
  sendProgress('Downloading image...')
  await downloadFile(imgFile.file_url, outputPath)
  knownLocalPaths.add(outputPath)
  await sendSavedLine(outputPath, sendProgress)
  return outputPath
}

// nativeImage can't decode WebP for the POYO reference upload — convert via sips first
async function uploadRefToPOYO(path: string, apiKey: string): Promise<string> {
  if (!path.toLowerCase().endsWith('.webp')) return uploadFrameToPOYO(path, apiKey, 0)
  const tmp = path.replace(/\.webp$/i, '_ref.jpg')
  await execFileAsync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '90', path, '--out', tmp])
  try {
    return await uploadFrameToPOYO(tmp, apiKey, 0)
  } finally {
    try { unlinkSync(tmp) } catch {}
  }
}

handleWhenUnlocked('fire-model', async (event, { prompt, engine, aspectRatio, resolution, gender }: {
  prompt: string; engine: string; aspectRatio: string; resolution: string; gender: string
}) => {
  if (typeof prompt !== 'string' || prompt.trim().length === 0 || prompt.length > 10000) throw new Error('Invalid prompt')

  const sendProgress = (line: string) => event.sender.send('higgsfield-progress', { scope: 'model', line })
  const safeGender = gender === 'male' ? 'male' as const : 'female' as const
  const safeEngine = engine === 'recraft' ? 'recraft' : 'nb2'
  const safeSize = MODEL_RATIOS.includes(aspectRatio as typeof MODEL_RATIOS[number]) ? aspectRatio : '4:5'
  const safeRes = ['1k', '2k', '4k'].includes(resolution) ? resolution.toUpperCase() : '2K'
  const poyoKey = process.env.POYO_API_KEY

  // 1 — allocate the next SKU folder (SMF### female / SMM### male)
  let sku: string; let dir: string
  try {
    ({ sku, dir } = allocateSku(safeGender))
  } catch (err) {
    const msg = `Cannot access ${MODELS_DIR} — ${err instanceof Error ? err.message : String(err)}`
    sendProgress(msg)
    return { success: false, sku: '', outputPath: '', facePath: '', error: msg }
  }
  sendProgress(`SKU ${sku} · Modelos/${safeGender === 'male' ? 'SMM' : 'SMF'}/${sku}/`)

  try {
    // 2 — primary model generation
    let fullPath: string
    try {
      if (safeEngine === 'recraft') {
        fullPath = await recraftGenerateToFile(prompt, safeSize, dir, sku, sendProgress)
      } else {
        if (!poyoKey) throw new Error('POYO_API_KEY not set — add it to ~/.bmp.env')
        sendProgress(`Submitting Nano Banana 2 (${safeSize} · ${safeRes})...`)
        fullPath = await poyoGenerateToFile({
          model: 'nano-banana-2', input: { prompt, size: safeSize, resolution: safeRes },
          apiKey: poyoKey, destDir: dir, baseName: sku, sendProgress,
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      sendProgress(`Error: ${msg}`)
      try { rmdirSync(dir) } catch {} // drop the folder only if nothing was saved
      return { success: false, sku, outputPath: '', facePath: '', error: msg }
    }

    // 3 — automatic macro face shot: nano-banana-2-edit with the fresh render
    // as identity reference, so the close-up is the SAME person
    let facePath = ''
    let faceError: string | undefined
    if (!poyoKey) {
      faceError = 'POYO_API_KEY not set — face macro skipped'
      sendProgress(faceError)
    } else {
      try {
        sendProgress('▶ Macro face shot — uploading reference...')
        const refUrl = await uploadRefToPOYO(fullPath, poyoKey)
        facePath = await poyoGenerateToFile({
          model: 'nano-banana-2-edit',
          input: { prompt: MACRO_FACE_PROMPT, size: '4:5', resolution: '2K', image_urls: [refUrl] },
          apiKey: poyoKey, destDir: dir, baseName: `${sku}_FACE`, sendProgress,
        })
      } catch (err) {
        faceError = err instanceof Error ? err.message : String(err)
        sendProgress(`Face macro failed — ${faceError}`)
      }
    }

    if (facePath) sendProgress(`${sku} complete ✓ — full body + face macro`)
    return { success: true, sku, outputPath: fullPath, facePath, error: faceError }
  } finally {
    reservedSkus.delete(sku)
  }
})

handleWhenUnlocked('fire-video', async (event, { prompt, products: frames, videoModel, aspectRatio, resolution, duration }: {
  prompt: string; products: string[]; videoModel: string; aspectRatio: string; resolution: string; duration: number
}) => {
  if (typeof prompt !== 'string' || prompt.trim().length === 0) throw new Error('Invalid prompt')
  if (!Array.isArray(frames) || frames.length > 9) throw new Error('Invalid frames')

  const apiKey = process.env.POYO_API_KEY
  if (!apiKey) throw new Error('POYO_API_KEY not set — add it to ~/.bmp.env')

  const timestamp = Date.now()
  const desktopPath = loadPrefs().outputPath
  const sendProgress = (line: string) => event.sender.send('higgsfield-progress', { scope: 'video', line })

  // Validate @ImageN tags in prompt match available frames
  const tagRefs = [...prompt.matchAll(/@Image(\d+)/gi)].map((m) => parseInt(m[1]))
  const maxTag = tagRefs.length > 0 ? Math.max(...tagRefs) : 0
  if (maxTag > frames.length) {
    sendProgress(`Warning: prompt references @Image${maxTag} but only ${frames.length} frame${frames.length !== 1 ? 's' : ''} provided`)
  }

  // Upload frames in parallel — order is critical (@Image1 = frames[0])
  let referenceImageUrls: string[] = []
  if (frames.length > 0) {
    try {
      referenceImageUrls = await uploadFilesToPOYO(frames, apiKey, sendProgress)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      sendProgress(msg)
      return { success: false, outputPath: '', error: msg }
    }
  }

  // Build request input
  // Audio siempre apagado — decisión de producto 2026-07-03
  const input: Record<string, unknown> = {
    prompt,
    resolution,
    duration,
    generate_audio: false,
  }
  if (aspectRatio !== 'auto') input.aspect_ratio = aspectRatio
  if (referenceImageUrls.length > 0) input.reference_image_urls = referenceImageUrls

  sendProgress(`Submitting to Seedance 2 (${aspectRatio} · ${resolution} · ${duration}s)...`)

  // Submit task
  const submitRes = await fetch('https://api.poyo.ai/api/generate/submit', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: videoModel, input }),
  })
  const submitData = await submitRes.json() as { code?: number; data?: { task_id: string; status: string }; error?: { message: string } }

  if (!submitRes.ok || !submitData.data?.task_id) {
    const msg = submitData.error?.message ?? `HTTP ${submitRes.status}`
    sendProgress(`Submit error: ${msg}`)
    return { success: false, outputPath: '', error: msg }
  }

  const taskId = submitData.data.task_id
  sendProgress(`Generating... (task: ${taskId})`)

  try {
    const files = await pollPOYOTask(taskId, apiKey, sendProgress)
    const videoFile = files.find((f) => f.file_type === 'video' || f.file_url.match(/\.mp4|\.mov/i))
    if (!videoFile) { sendProgress('No video file in response'); return { success: false, outputPath: '', error: 'No video file' } }
    const outputName = `bmp_video_${timestamp}.mp4`
    const outputPath = join(desktopPath, outputName)
    sendProgress('Downloading video...')
    await downloadFile(videoFile.file_url, outputPath)
    sendProgress(`Saved: ${outputName}`)
    return { success: true, outputPath }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    sendProgress(`Error: ${msg}`)
    return { success: false, outputPath: '', error: msg }
  }
})

// Scales the initial window to the display it opens on instead of a fixed
// 920×720, so it looks right from a 13" laptop to an ultrawide/5K monitor.
// Bounds are chosen so a standard 1920×1080 screen lands ~920×720 — same as
// the old hardcoded size — while smaller/larger screens get a proportional
// window instead of one that's oversized or cramped.
function initialWindowSize(): { width: number; height: number } {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize
  const width = Math.round(Math.min(Math.max(screenW * 0.48, 800), 1100))
  const height = Math.round(Math.min(Math.max(screenH * 0.72, 600), 860))
  return { width, height }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    ...initialWindowSize(),
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0c0c0c',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, '../preload/preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Was 1.1 (+10% UI) — now 0.95 (-5% off native), shrinking the whole
      // interface a bit further; window sizing above does the screen-adaptive
      // work a manual zoom hack used to approximate.
      zoomFactor: 0.95,
      spellcheck: false,
    },
  })

  // webPreferences zoomFactor is unreliable on first load for non-default
  // values — enforce it once the page is up
  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomFactor(0.95)
  })

  win.webContents.on('will-navigate', e => e.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

// Allow renderer to load local file images via localfile:// regardless of HTTP origin
protocol.registerSchemesAsPrivileged([
  { scheme: 'localfile', privileges: { secure: true, supportFetchAPI: true, bypassCSP: true } },
])

async function installFromDmg(dmgPath: string): Promise<void> {
  // Mount the DMG silently and get the mount point from the plist output
  const { stdout } = await execFileAsync('hdiutil', ['attach', dmgPath, '-nobrowse', '-plist'], { env: shellEnv() })
  const mountMatch = stdout.match(/<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/)
  if (!mountMatch) throw new Error('DMG mount point not found')
  const mountPoint = mountMatch[1].trim()

  try {
    // ditto preserves app bundle structure and permissions
    await execFileAsync('ditto', [`${mountPoint}/BMP.app`, '/Applications/BMP.app'], { env: shellEnv() })
  } finally {
    // Always unmount, even if copy failed
    await execFileAsync('hdiutil', ['detach', mountPoint, '-quiet', '-force'], { env: shellEnv() }).catch(() => {})
  }
}

function setupAutoUpdater(win: BrowserWindow) {
  // Only run in packaged app — skip in dev
  if (!app.isPackaged) return

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  const notify = (payload: object) => win.webContents.send('update-status', payload)

  autoUpdater.on('update-available', (info) => {
    notify({ phase: 'available', version: info.version })

    const arch = process.arch === 'arm64' ? '-arm64' : ''
    const filename = `BMP-${info.version}${arch}.dmg`
    const dmgUrl = `https://github.com/createdbynoone/bmp/releases/download/v${info.version}/${filename}`
    const tmpPath = join(app.getPath('temp'), filename)

    downloadDmgWithProgress(dmgUrl, tmpPath, undefined, (percent) => {
      notify({ phase: 'downloading', percent, version: info.version })
    })
      .then(async () => {
        notify({ phase: 'installing', version: info.version })
        await installFromDmg(tmpPath)
        notify({ phase: 'ready', version: info.version })
        // Relaunch using Electron's built-in relaunch — process.execPath points
        // to the binary inside /Applications/BMP.app which ditto just replaced
        setTimeout(() => {
          app.relaunch()
          app.quit()
        }, 1500)
      })
      .catch(async (err: Error) => {
        // Silent install failed — fall back to opening the DMG manually
        notify({ phase: 'error', error: `Auto-install fallido, abriendo DMG: ${err.message}` })
        const desktopPath = join(homedir(), 'Desktop', filename)
        try {
          await downloadFile(dmgUrl, desktopPath)
          await shell.openPath(desktopPath)
        } catch {}
      })
  })

  autoUpdater.on('error', (err) => {
    notify({ phase: 'error', error: err.message })
  })

  // Wait for renderer to load before checking so first events aren't lost
  win.webContents.once('did-finish-load', () => autoUpdater.checkForUpdates())
}

app.whenReady().then(() => {
  protocol.handle('localfile', (request) => {
    const filePath = decodeURIComponent(request.url.slice('localfile://'.length))
    // Only serve paths the renderer legitimately resolved (a real Finder drag
    // via getPathForFile) and only once unlocked — otherwise ANY path on disk
    // would be readable through this scheme.
    if (!unlocked || !knownLocalPaths.has(filePath)) {
      return new Response('Forbidden', { status: 403 })
    }
    return net.fetch(`file://${filePath}`)
  })
  unlocked = Boolean(loadPrefs().unlockedAt)
  buildAppMenu()
  applyDockIcon(loadPrefs().iconStyle)
  const win = createWindow()
  setupAutoUpdater(win)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
