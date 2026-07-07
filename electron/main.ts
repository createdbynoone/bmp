import { app, BrowserWindow, ipcMain, shell, nativeImage, protocol, net, Menu, dialog } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, createWriteStream } from 'fs'
import { homedir } from 'os'
import { execFile, exec } from 'child_process'
import { promisify } from 'util'
import { scryptSync, timingSafeEqual } from 'crypto'
import https from 'https'
import Anthropic from '@anthropic-ai/sdk'
import electronUpdater from 'electron-updater'
const { autoUpdater } = electronUpdater

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
    if (!icon.isEmpty()) app.dock.setIcon(icon)
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

const ANGLE_SYSTEM_PROMPT = `You are a fashion photography camera director. You receive one NanaBanana2 (Higgsfield) editorial prompt for Brotherhood streetwear following the [SCENE]/[GARMENT]/[PLACEMENT/INTERACTION]/[COMPOSITION]/[LIGHTING]/[CAMERA]/[MOOD] structure.

Produce exactly 4 variations of the SAME shot changing ONLY the camera work: rewrite [COMPOSITION] and [CAMERA] (lens choice may change), and adjust [LIGHTING] direction wording only where the new angle physically requires it. Everything else — scene, garment description, placement, mood, safety wording — must remain identical word-for-word.

Choose the 4 angle treatments most editorially useful FOR THIS SPECIFIC SHOT, drawing from: tighter close-up / macro detail crop on the garment graphic, 3/4 orbit rotation left or right, low-angle hero shot, high-angle or top-down, profile view, wide establishing pull-back, over-the-shoulder, subtle dutch tilt. The 4 must be clearly distinct from each other and from the original framing.

Output STRICT JSON only — no markdown fences, no commentary:
[{"label":"<2-4 word angle name>","prompt":"<full modified prompt>"},{...},{...},{...}]`

handleWhenUnlocked('generate-angle-variations', async (_event, { prompt }: { prompt: string }) => {
  if (typeof prompt !== 'string' || prompt.trim().length === 0 || prompt.length > 12000) {
    throw new Error('Invalid prompt')
  }

  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    system: ANGLE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `Base prompt:\n\n${prompt}\n\nGenerate the 4 angle variations now.` }],
  })

  const block = message.content[0]
  if (block.type !== 'text') throw new Error('Unexpected response type')

  // Strip accidental markdown fences before parsing
  const raw = block.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let variants: Array<{ label: string; prompt: string }>
  try {
    variants = JSON.parse(raw)
  } catch {
    throw new Error('Claude returned invalid JSON for angle variations')
  }
  if (!Array.isArray(variants) || variants.length === 0) throw new Error('No angle variations returned')
  variants = variants
    .filter((v) => v && typeof v.label === 'string' && typeof v.prompt === 'string' && v.prompt.trim().length > 0)
    .slice(0, 4)
  if (variants.length === 0) throw new Error('No valid angle variations returned')

  return { variants }
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

const HF_VALID_RESOLUTIONS = ['1k', '2k'] as const
const HF_VALID_ASPECT_RATIOS = ['9:16', '4:5', '1:1', '16:9', '1:2', '2:1'] as const

handleWhenUnlocked('fire-higgsfield', async (event, { prompt, aspectRatio, products, resolution }: { prompt: string; aspectRatio: string; products: string[]; resolution?: string }) => {
  if (typeof prompt !== 'string' || prompt.trim().length === 0 || prompt.length > 12000) {
    throw new Error('Invalid prompt')
  }
  if (!Array.isArray(products) || products.length > 30) throw new Error('Invalid products')

  const sendProgress = (line: string) => event.sender.send('higgsfield-progress', { scope: 'image', line })
  const timestamp = Date.now()
  const desktopPath = loadPrefs().outputPath

  const safeRes = HF_VALID_RESOLUTIONS.includes(resolution as typeof HF_VALID_RESOLUTIONS[number]) ? resolution : '1k'
  const safeRatio = HF_VALID_ASPECT_RATIOS.includes(aspectRatio as typeof HF_VALID_ASPECT_RATIOS[number]) ? aspectRatio : '4:5'

  sendProgress('Starting Higgsfield generation...')

  const args = [
    'generate', 'create', 'nano_banana_2',
    '--prompt', prompt,
    '--resolution', safeRes || '1k',
    '--aspect_ratio', safeRatio || '4:5',
    '--wait',
  ]

  if (products.length > 0) {
    for (const p of products) args.push('--image', p)
    sendProgress(`Uploading ${products.length} product image${products.length > 1 ? 's' : ''} as reference...`)
  }

  try {
    const { stdout, stderr } = await execFileAsync('higgsfield', args, { timeout: 300_000, env: shellEnv() })
    const combined = (stdout + '\n' + stderr).trim()
    if (combined) sendProgress(combined)

    const cliError = combined.match(/\b(error|failed|failure|rejected|content.?policy|moderat|violat|unsafe|prohibited)\b/i)
    if (cliError) {
      const snippet = combined.slice(0, 200)
      sendProgress(`Generation failed — ${snippet}`)
      return { success: false, outputPath: '', error: snippet }
    }

    const urlMatch = combined.match(/https:\/\/\S+\.(png|jpg|jpeg|webp)/i)
    if (urlMatch) {
      const imageUrl = urlMatch[0]
      const ext = imageUrl.split('.').pop()?.split('?')[0] ?? 'jpg'
      const outputName = `bmp_${timestamp}.${ext}`
      const outputPath = join(desktopPath, outputName)
      sendProgress('Downloading to Desktop...')
      await downloadFile(imageUrl, outputPath)
      sendProgress(`Saved: ${outputName}`)
      return { success: true, outputPath }
    }

    sendProgress('Generation failed — no image URL in CLI output')
    return { success: false, outputPath: '', error: 'No image URL in output' }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    sendProgress(`Error: ${msg}`)
    return { success: false, outputPath: '', error: msg }
  }
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

// ── POYO.ai Nano Banana 2 — image generation ───────────────────────────────────

const NB2_RATIOS = ['9:16', '4:5', '1:1', '16:9'] as const
const POYO_MAX_REFS = 14 // POYO nano-banana-2(-edit) hard limit: 14 reference images per request

// Upload product refs once and return their POYO URLs — used to fan out multiple
// generations (variations / angles) without re-uploading the same images per task
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

handleWhenUnlocked('fire-poyo-image', async (event, { prompt, products, aspectRatio, resolution, imageUrls: presetUrls }: {
  prompt: string; products: string[]; aspectRatio: string; resolution: string; imageUrls?: string[]
}) => {
  if (typeof prompt !== 'string' || prompt.trim().length === 0) throw new Error('Invalid prompt')
  if (!Array.isArray(products)) throw new Error('Invalid products')
  if (presetUrls !== undefined && (!Array.isArray(presetUrls) || presetUrls.some((u) => typeof u !== 'string'))) throw new Error('Invalid imageUrls')

  const apiKey = process.env.POYO_API_KEY
  if (!apiKey) throw new Error('POYO_API_KEY not set — add it to ~/.bmp.env')

  const timestamp = Date.now()
  const desktopPath = loadPrefs().outputPath
  const sendProgress = (line: string) => event.sender.send('higgsfield-progress', { scope: 'image', line })
  const safeSize = NB2_RATIOS.includes(aspectRatio as typeof NB2_RATIOS[number]) ? aspectRatio : '4:5'
  const safeRes = ['1k', '2k', '4k'].includes(resolution) ? resolution.toUpperCase() : '2K'

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
  const model = imageUrls.length > 0 ? 'nano-banana-2-edit' : 'nano-banana-2'
  const input: Record<string, unknown> = { prompt, size: safeSize, resolution: safeRes }
  if (imageUrls.length > 0) input.image_urls = imageUrls

  sendProgress(`Submitting Nano Banana 2 (${safeSize} · ${safeRes})...`)

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

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 920,
    height: 720,
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
      zoomFactor: 1.1,
    },
  })

  // webPreferences zoomFactor is unreliable on first load — enforce it
  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomFactor(1.1)
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
