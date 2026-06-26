import { app, BrowserWindow, ipcMain, shell, nativeImage, protocol, net, Menu } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, createWriteStream } from 'fs'
import { homedir } from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import https from 'https'
import Anthropic from '@anthropic-ai/sdk'
import electronUpdater from 'electron-updater'
const { autoUpdater } = electronUpdater

// ─── Preferences ──────────────────────────────────────────────────────────────

const ICON_STYLES = ['Default', 'Dark', 'ClearLight', 'ClearDark', 'TintedLight', 'TintedDark'] as const
type IconStyle = typeof ICON_STYLES[number]

interface Prefs {
  iconStyle: IconStyle
}

function prefsPath(): string {
  return join(app.getPath('userData'), 'bmp-prefs.json')
}

function loadPrefs(): Prefs {
  try {
    const raw = readFileSync(prefsPath(), 'utf-8')
    return { iconStyle: 'Default', ...JSON.parse(raw) }
  } catch {
    return { iconStyle: 'Default' }
  }
}

function savePrefs(prefs: Prefs) {
  writeFileSync(prefsPath(), JSON.stringify(prefs, null, 2), 'utf-8')
}

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
- Output ONLY the prompt text, no preamble or explanation`

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

ipcMain.handle('generate-prompt', async (_event, { refs, products, description }: { refs: string[]; products: string[]; description: string }) => {
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
    model: 'claude-sonnet-4-6',
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

ipcMain.handle('mark-prompt-fired', (_event, { id, aspectRatio }: { id: string; aspectRatio: string }) => {
  markFired(id, aspectRatio)
})

ipcMain.handle('get-memory-stats', () => {
  const memory = loadMemory()
  return {
    total: memory.entries.length,
    fired: memory.entries.filter(e => e.fired).length,
  }
})

ipcMain.handle('check-higgsfield-auth', async () => {
  try {
    const credsPath = join(homedir(), '.config', 'higgsfield', 'credentials.json')
    const raw = readFileSync(credsPath, 'utf-8')
    const creds = JSON.parse(raw)
    return { authenticated: !!(creds.access_token) }
  } catch {
    return { authenticated: false }
  }
})

ipcMain.handle('higgsfield-login', async () => {
  try {
    execFile('higgsfield', ['auth', 'login'], { env: shellEnv() })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
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

ipcMain.handle('get-higgsfield-credits', async () => {
  try {
    const { stdout } = await execFileAsync('higgsfield', ['account', 'status', '--json'], { env: shellEnv() })
    const data = JSON.parse(stdout.trim())
    return { credits: data.credits ?? 0, plan: data.subscription_plan_type ?? 'free' }
  } catch {
    return { credits: null, plan: null }
  }
})

const VALID_RESOLUTIONS = ['1k', '2k'] as const
const VALID_ASPECT_RATIOS = ['9:16', '4:5', '1:1', '16:9', '1:2', '2:1'] as const

ipcMain.handle('fire-higgsfield', async (event, { prompt, aspectRatio, products, resolution }: { prompt: string; aspectRatio: string; products: string[]; resolution?: string }) => {
  if (typeof prompt !== 'string' || prompt.trim().length === 0 || prompt.length > 4000) {
    throw new Error('Invalid prompt')
  }
  const safeResolution = VALID_RESOLUTIONS.includes(resolution as typeof VALID_RESOLUTIONS[number]) ? resolution : '1k'
  const safeAspectRatio = VALID_ASPECT_RATIOS.includes(aspectRatio as typeof VALID_ASPECT_RATIOS[number]) ? aspectRatio : '4:5'
  if (!Array.isArray(products) || products.length > 30) throw new Error('Invalid products')

  const timestamp = Date.now()
  const desktopPath = join(homedir(), 'Desktop')

  const sendProgress = (line: string) => {
    event.sender.send('higgsfield-progress', line)
  }

  sendProgress('Starting Higgsfield generation...')

  const args = [
    'generate', 'create', 'nano_banana_2',
    '--prompt', prompt,
    '--resolution', safeResolution || '1k',
    '--aspect_ratio', safeAspectRatio || '4:5',
    '--wait',
  ]

  // Attach all product images as visual reference — CLI auto-uploads local paths
  if (products && products.length > 0) {
    for (const p of products) args.push('--image', p)
    sendProgress(`Uploading ${products.length} product image${products.length > 1 ? 's' : ''} as reference...`)
  }

  try {
    const { stdout, stderr } = await execFileAsync('higgsfield', args, { timeout: 300_000, env: shellEnv() })
    const combined = (stdout + '\n' + stderr).trim()
    if (combined) sendProgress(combined)

    // Parse CDN URL from output (cloudfront or any https URL ending in image ext)
    const urlMatch = combined.match(/https:\/\/\S+\.(png|jpg|jpeg|webp)/i)
    if (urlMatch) {
      const imageUrl = urlMatch[0]
      const ext = imageUrl.split('.').pop()?.split('?')[0] ?? 'jpg'
      const outputName = `bmp_${timestamp}.${ext}`
      const outputPath = join(desktopPath, outputName)
      sendProgress(`Downloading to Desktop...`)
      await downloadFile(imageUrl, outputPath)
      sendProgress(`Saved: ${outputName}`)
      shell.showItemInFolder(outputPath)
      return { success: true, outputPath }
    }

    sendProgress('Generation complete — no image URL found in output')
    return { success: true, outputPath: '' }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    sendProgress(`Error: ${msg}`)
    return { success: false, outputPath: '' }
  }
})

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 920,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0a0a0a',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, '../preload/preload.mjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

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

function setupAutoUpdater(win: BrowserWindow) {
  // Only run in packaged app — skip in dev
  if (!app.isPackaged) return

  // Only use electron-updater to detect new versions — skip ShipIt install
  // (ShipIt requires code signing; we handle the actual download ourselves)
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  const notify = (payload: object) => win.webContents.send('update-status', payload)

  autoUpdater.on('update-available', (info) => {
    notify({ phase: 'available', version: info.version })

    // Download the DMG directly, bypassing ShipIt
    const arch = process.arch === 'arm64' ? '-arm64' : ''
    const filename = `BMP-${info.version}${arch}.dmg`
    const dmgUrl = `https://github.com/createdbynoone/bmp/releases/download/v${info.version}/${filename}`
    const destPath = join(homedir(), 'Desktop', filename)

    downloadDmgWithProgress(dmgUrl, destPath, undefined, (percent) => {
      notify({ phase: 'downloading', percent, version: info.version })
    })
      .then(async () => {
        notify({ phase: 'ready', version: info.version })
        await shell.openPath(destPath)
        // Quit after short delay so user sees the installer before the app closes
        setTimeout(() => app.quit(), 2000)
      })
      .catch((err: Error) => {
        notify({ phase: 'error', error: err.message })
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
    return net.fetch(`file://${filePath}`)
  })
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
