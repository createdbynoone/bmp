# BMP — Brotherhood Marketing Prompts

Electron app para generar prompts de marketing de prendas Brotherhood y dispararlos a providers de imagen/video.

**Dev:** `npm run dev`
**Release:** `GH_TOKEN=ghp_... bash scripts/publish.sh`
**Versión actual:** `1.3.9`

## Stack
- Electron 31 + electron-vite + React 18 + Tailwind
- electron-builder 24 (DMG + ZIP, arm64 + x64)
- electron-updater 6
- @anthropic-ai/sdk `claude-sonnet-4-6` con visión

## Modos

### Image (`[HF | AI | NB2]`)
| Provider | Modelo | Ratios | Resoluciones | Variaciones |
|---|---|---|---|---|
| HF (Higgsfield) | nano_banana_2 CLI | 9:16 / 4:5 / 1:1 | 1k / 2k | ×1–4 |
| AI (Gemini) | gemini-3-pro-image | 9:16 / 3:4 / 1:1 | 1k / 2k / 4k | ×1–4 |
| NB2 (POYO) | nano-banana-2(-edit) | 9:16 / 4:5 / 3:4 / 1:1 / 16:9 | 1K / 2K / 4K | — |

### Video (Seedance 2 / POYO)
- El usuario escribe el prompt manualmente
- Frames drag & drop (max 9) → referenciados con `@Image1`, `@Image2`...
- Modelos: `seedance-2` (PRO) / `seedance-2-fast` (FAST)
- Ratios: 9:16 / 16:9 / 1:1 / auto | Resoluciones: 720p / 1080p / 4k | Duración: 5/10/15s

## Claves de entorno (`~/.bmp.env`)
```
GEMINI_API_KEY=...
POYO_API_KEY=...
```

## POYO API
```
POST /api/generate/submit        → { data: { task_id } }
GET  /api/generate/status/{id}   → { data: { status, progress, files } }
POST /api/common/upload/base64   → body: { base64_data, file_name }
```
Finish states: `finished | completed | succeeded`

## Shared utilities (main.ts)
- `uploadFrameToPOYO` — resize 1280px JPEG 90% → POST base64
- `uploadFilesToPOYO` — parallel uploads, aborta si falla uno (índices críticos)
- `pollPOYOTask` — 8s wait inicial, 5s interval, log solo en cambio de status

## Preload — CRÍTICO
Debe compilar como **CJS** (`.cjs`). Con `sandbox: true`, ES modules en preload → `window.bmp` undefined.
```ts
// electron.vite.config.ts
output: { format: 'cjs', entryFileNames: '[name].cjs' }
// main.ts
preload: join(__dirname, '../preload/preload.cjs')
```

## IPC handlers (main.ts)
- `generate-prompt` — Claude Sonnet 4.6 visión → prompt
- `fire-higgsfield` — Higgsfield CLI o Gemini según `provider`
- `fire-poyo-image` — POYO Nano Banana 2
- `fire-video` — POYO Seedance 2
- `check-higgsfield-auth` — verifica GEMINI_API_KEY presente
- `get-output-path` / `set-output-path` / `open-folder-dialog`
- `get-memory-stats` / `get-memory-entries` / `mark-prompt-fired`

## Release
```bash
# 1. Bump version en package.json
# 2. git add + commit + push
GH_TOKEN=ghp_<classic_token_repo_scope> bash scripts/publish.sh
```
- Token **classic** con scope `repo` (fine-grained → 403)
- Token inline, nunca con `export` (no se propaga al subproceso bash)
- `releaseType: "release"` en build.publish → no drafts

## Auto-update (sin code signing)
`hdiutil attach` → `ditto` → `hdiutil detach` → `app.relaunch()`
No usar `shell.openPath()` (trae ventana existente, no nueva instancia).
</content>
</invoke>