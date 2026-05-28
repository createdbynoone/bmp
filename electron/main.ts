import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import Anthropic from '@anthropic-ai/sdk'

const execFileAsync = promisify(execFile)

// Load .env from app root (dev) or resources (prod)
function loadEnv() {
  try {
    const envPath = app.isPackaged
      ? join(process.resourcesPath, '.env')
      : join(__dirname, '../../.env')
    const raw = readFileSync(envPath, 'utf-8')
    for (const line of raw.split('\n')) {
      const [key, ...rest] = line.split('=')
      if (key && rest.length) process.env[key.trim()] = rest.join('=').trim()
    }
  } catch {}
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

function filesToVisionContent(paths: string[]): Anthropic.ImageBlockParam[] {
  return paths.map((p) => {
    const data = readFileSync(p)
    const b64 = data.toString('base64')
    const ext = p.split('.').pop()?.toLowerCase() ?? 'jpg'
    const mediaMap: Record<string, Anthropic.Base64ImageSource['media_type']> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
    }
    return {
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: mediaMap[ext] ?? 'image/jpeg',
        data: b64,
      },
    }
  })
}

ipcMain.handle('generate-prompt', async (_event, { refs, products, description }: { refs: string[]; products: string[]; description: string }) => {
  const refImages = filesToVisionContent(refs)
  const productImages = filesToVisionContent(products)

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
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  })

  const block = message.content[0]
  if (block.type !== 'text') throw new Error('Unexpected response type')
  return block.text
})

ipcMain.handle('fire-higgsfield', async (event, { prompt }: { prompt: string }) => {
  const timestamp = Date.now()
  const tmpFile = join(tmpdir(), `bmp_prompt_${timestamp}.txt`)
  writeFileSync(tmpFile, prompt, 'utf-8')

  const desktopPath = join(homedir(), 'Desktop')
  const outputName = `bmp_${timestamp}.jpg`
  const outputPath = join(desktopPath, outputName)

  const sendProgress = (line: string) => {
    event.sender.send('higgsfield-progress', line)
  }

  sendProgress('Starting Higgsfield generation...')

  // Build args
  const args = [
    'generate', 'create', 'nano_banana_flash',
    '--prompt', prompt,
    '--resolution', '1k',
    '--aspect_ratio', '4:5',
    '--wait',
  ]

  try {
    const { stdout, stderr } = await execFileAsync('higgsfield', args, {
      timeout: 300_000,
    })

    if (stdout) sendProgress(stdout)
    if (stderr) sendProgress(stderr)

    // Try to find and copy output to Desktop
    // higgsfield typically downloads to ~/Downloads or current dir — check both
    const possiblePaths = [
      join(homedir(), 'Downloads', `${timestamp}.jpg`),
      join(homedir(), 'Downloads', 'output.jpg'),
    ]

    let found = false
    for (const p of possiblePaths) {
      try {
        const { copyFileSync } = await import('fs')
        copyFileSync(p, outputPath)
        found = true
        break
      } catch {}
    }

    sendProgress(found ? `Saved to Desktop: ${outputName}` : 'Generation complete — check ~/Downloads')
    if (found) shell.showItemInFolder(outputPath)

    return { success: true, outputPath: found ? outputPath : '' }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    sendProgress(`Error: ${msg}`)
    return { success: false, outputPath: '' }
  }
})

function createWindow() {
  const win = new BrowserWindow({
    width: 920,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0a0a0a',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      sandbox: false,
      contextIsolation: true,
    },
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
