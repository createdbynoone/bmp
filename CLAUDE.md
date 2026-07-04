# BMP — Brotherhood Marketing Prompts

Electron app para generar prompts de marketing de prendas Brotherhood y dispararlos a providers de imagen/video.

**Dev:** `npm run dev`
**Release:** `bash scripts/publish.sh` (build local + subida via gh — ver sección Release)
**Versión actual:** `1.5.0` (2026-07-03: tareas por modo en background al cambiar de pestaña, Angles ×4, modelo `claude-sonnet-5`, Gemini removido, POYO refs pre-upload + cap 14, ratios reducidos, audio de video siempre off)

## Stack
- Electron 43 + electron-vite 5 + vite 7 + React 18 + Tailwind
- electron-builder 26 (DMG + ZIP, arm64 + x64) — **el tag debe existir en el remoto antes de publicar** (422 "valid tag" si no)
- electron-updater 6
- @anthropic-ai/sdk 0.109+ (`claude-sonnet-5` con visión, constante `CLAUDE_MODEL` en main.ts) — <0.40 rompe en Electron 43 (gunzip "Premature close")
- **Electron 32+ eliminó `File.path`** — drag & drop usa `webUtils.getPathForFile()` expuesto como `window.bmp.getPathForFile`
- zoomFactor 1.1 global (+10% UI, en webPreferences + did-finish-load); will-navigate prevented + setWindowOpenHandler deny
- Contraste: text-secondary #9A9A9A / text-muted #666666; titlebar h-11 alineado a semáforos

## Modos

### Image (`[HF | NB2]`) — Gemini removido 2026-07-03
Ratios unificados para ambos providers: **9:16 / 4:5 / 1:1 / 16:9** (default 4:5)
| Provider | Modelo | Resoluciones | Variaciones |
|---|---|---|---|
| HF (Higgsfield) | nano_banana_2 CLI | 1k / 2k | ×1–4 |
| NB2 (POYO, default) | nano-banana-2(-edit) | 1K / 2K / 4K | ×1–4 |

**POYO límite duro: max 14 imágenes de referencia por request** (`POYO_MAX_REFS`). La app las recorta a 14 con warning en vez de fallar. Para disparos paralelos (variaciones/angles) las refs se suben UNA vez via `upload-poyo-refs` y las URLs se comparten (`imageUrls` en `fire-poyo-image`) — re-subir por tarea reventaba rate limits de POYO.

### Video (Seedance 2 / POYO)
- El usuario escribe el prompt manualmente
- Frames drag & drop (max 9) → referenciados con `@Image1`, `@Image2`...
- Modelos: `seedance-2` (PRO) / `seedance-2-fast` (FAST)
- Ratios: 9:16 / 16:9 / auto | Resoluciones: 720p / 1080p | Duración: 5/10/15s
- Audio SIEMPRE apagado (`generate_audio: false` hardcoded en fire-video; toggle removido de la UI)

## Claves de entorno (`~/.bmp.env`)
```
POYO_API_KEY=...
```
(GEMINI_API_KEY ya no se usa — provider Gemini removido)

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

## Tareas en background por modo
- `fireStatus`/`fireProgress` están **scoped por modo** (`imageFireStatus`/`videoFireStatus`, `imageProgress`/`videoProgress`) — cambiar de pestaña NO cancela ni oculta la tarea en curso
- El canal `higgsfield-progress` emite `{ scope: 'image' | 'video', line }` (ya no un string plano) y el renderer enruta cada línea a su log
- La pestaña con tarea activa muestra un punto accent pulsante

## Angles ×4
- Botón `ANGLES ×4` en la barra inferior (modo image, requiere prompt generado)
- Handler `generate-angle-variations`: Claude reescribe solo [COMPOSITION]/[CAMERA] (y [LIGHTING] si el ángulo lo exige) → JSON estricto de 4 `{label, prompt}` → se disparan en paralelo con el provider activo

## IPC handlers (main.ts)
- `generate-prompt` — Claude Sonnet 5 visión → prompt
- `generate-angle-variations` — Claude Sonnet 5 → 4 variaciones de ángulo del prompt
- `fire-higgsfield` — Higgsfield CLI (solo HF; Gemini removido)
- `fire-poyo-image` — POYO Nano Banana 2 (acepta `imageUrls` pre-subidas)
- `upload-poyo-refs` — sube refs una vez, retorna URLs para fan-out paralelo
- `fire-video` — POYO Seedance 2
- `check-higgsfield-auth` — verifica POYO_API_KEY presente
- `get-output-path` / `set-output-path` / `open-folder-dialog`
- `get-memory-stats` / `get-memory-entries` / `mark-prompt-fired`

## Release (electron-builder 26)
```bash
npm version X.Y.Z --no-git-tag-version
git add package.json package-lock.json && git commit -m "vX.Y.Z" && git push
git tag vX.Y.Z && git push origin vX.Y.Z
bash scripts/publish.sh   # usa gh auth — no necesita GH_TOKEN
```
- `publish.sh` (2026-07-02, determinista): construye con `electron-builder --mac --publish never` (una sola invocación, ambas arquitecturas), auto-verifica sha512 del `latest-mac.yml` vs zips locales, y sube los 9 assets con `gh release upload --clobber`
- **NO usar `--publish always`**: el publisher de GitHub de electron-builder corre tasks duplicados que se sobreescriben entre sí → assets inconsistentes con el yml. Tampoco correr el builder una vez por arch: los targets declaran `arch:["arm64","x64"]`, así que `--arm64`/`--x64` no filtran y cada pasada construye ambas con firma ad-hoc distinta
- Verificar release sin descargar: `gh api repos/createdbynoone/bmp/releases/tags/vX.Y.Z --jq '.assets[] | "\(.name) \(.digest)"'` vs `openssl dgst -sha256` local
- Si el publish falla a medias: borrar TODOS los assets (`gh release delete-asset ... --yes`) y re-correr limpio
- Correr publish con log a archivo, nunca con `| tail` (enmascara el exit code)

## Auto-update (sin code signing)
`hdiutil attach` → `ditto` → `hdiutil detach` → `app.relaunch()`
No usar `shell.openPath()` (trae ventana existente, no nueva instancia).
</content>
</invoke>