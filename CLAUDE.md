# BMP — Brotherhood Marketing Prompts

Electron app para generar prompts de marketing de prendas Brotherhood y dispararlos a providers de imagen/video.

**Dev:** `npm run dev`
**Release:** `bash scripts/publish.sh` (build local + subida via gh — ver sección Release)
**Versión actual:** `1.7.0` (2026-07-10: modo Model con macro face + SKU, tareas ref-count sin pausas, ActivityLog; Angles ×4 removido)

## Lock screen + seguridad (v1.6.0, 2026-07-07)
- Primer arranque en una máquina pide passphrase (`brother*1998_hood`, mismo patrón que Brotherhood Canvas/Sorter/Product Builder) antes de tocar filesystem/API keys — scrypt hash+salt propios en `main.ts`, nunca el texto plano; `timingSafeEqual`; backoff exponencial persistido en `bmp-prefs.json`
- `handleWhenUnlocked()` gatea todos los IPC (`generate-prompt`, `fire-higgsfield`, `fire-poyo-image`, `fire-video`, `upload-poyo-refs`, `get-memory-entries`, etc.)
- **Vulnerabilidad real corregida**: el protocolo `localfile://` hacía `net.fetch('file://' + path)` con CUALQUIER path, sin restricción. Ahora `knownLocalPaths` (Set poblado por el wrapper de `getPathForFile` en preload) es el único conjunto de paths servibles, y solo si `unlocked`
- CSP agregado a `index.html` (no existía)
- Para regenerar el hash si cambia la clave: `node -e "const c=require('crypto');const s=c.randomBytes(16);console.log(s.toString('hex'), c.scryptSync('NUEVA_CLAVE',s,64).toString('hex'))"` y reemplazar `LOCK_SALT_HEX`/`LOCK_HASH_HEX`

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

**POYO límite duro: max 14 imágenes de referencia por request** (`POYO_MAX_REFS`). La app las recorta a 14 con warning en vez de fallar. Para disparos paralelos (variaciones) las refs se suben UNA vez via `upload-poyo-refs` y las URLs se comparten (`imageUrls` en `fire-poyo-image`) — re-subir por tarea reventaba rate limits de POYO.

### Model (`[NB2 | RECRAFT]`) — creación de modelos de IA (2026-07-10)
- El usuario PEGA el prompt manualmente (Claude no lo genera); sin imágenes de referencia
- Engines: NB2 (POYO nano-banana-2 text→image, 1K/2K/4K) o **Recraft v4.1 Pro** (`recraftv4_1_pro`, siempre 4MP)
- **Pipeline completo en IPC `fire-model`** (main.ts): asigna SKU → genera full body → dispara automáticamente un **macro face shot** con `nano-banana-2-edit` usando el render recién generado como referencia de identidad (misma cara) y el preset `MACRO_FACE_PROMPT` (gender-neutral, 4:5 · 2K)
- **SKU + carpetas**: `SMF###` (female) / `SMM###` (male) en `/Volumes/Sandisk Home/Brotherhood/IA/Modelos/SMF|SMM/<SKU>/` con `<SKU>.<ext>` + `<SKU>_FACE.<ext>`; numeración auto-incremental escaneando la carpeta + `reservedSkus` (Set) contra carreras de fires paralelos; si la generación principal falla se hace `rmdirSync` del folder vacío
- Toggle `SMF | SMM` en la barra inferior con auto-detección de género desde el prompt (`detectGender` en App.tsx — "woman" nunca matchea `\bman\b`); el toggle siempre puede overridear
- Recraft API: `POST https://external.api.recraft.ai/v1/images/generations` (OpenAI-style, Bearer `RECRAFT_API_KEY`), respuesta `{ data: [{ url }] }`; tamaños pro en `RECRAFT_SIZES` (9:16→1536x2688, 4:5→1792x2304, 1:1→2048x2048, 16:9→2688x1536)
- **NO enviar `style`** — v4.1 Pro lo rechaza (`invalid_image_type`); el default ya es fotorealista
- La URL del resultado no trae extensión y sirve **WebP** — se descarga a `.download` y se renombra según magic bytes; para subir un WebP como ref a POYO se convierte antes a JPEG con `sips` (`uploadRefToPOYO` — nativeImage no decodifica WebP)
- Resultados: cards por SKU en `ModelMode.tsx` con FULL + FACE lado a lado y lightbox — main agrega outputs a `knownLocalPaths` para servirlos via `localfile://`
- Si el face macro falla, el resultado principal se conserva (success parcial con `error` y placeholder "face macro failed" en la card)

### Video (Seedance 2 / POYO)
- El usuario escribe el prompt manualmente
- Frames drag & drop (max 9) → referenciados con `@Image1`, `@Image2`...
- Modelos: `seedance-2` (PRO) / `seedance-2-fast` (FAST)
- Ratios: 9:16 / 16:9 / auto | Resoluciones: 720p / 1080p | Duración: 5/10/15s
- Audio SIEMPRE apagado (`generate_audio: false` hardcoded en fire-video; toggle removido de la UI)

## Claves de entorno (`~/.bmp.env`)
```
POYO_API_KEY=...
RECRAFT_API_KEY=...
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

## Tareas en background por modo (rediseño 2026-07-10)
- **Ref-count por modo** (`imageTasks`/`videoTasks`/`modelTasks`) + último resultado (`imageResult`...); el status del botón es derivado. NADA resetea una tarea en curso: generar prompt, cambiar provider/tab o Reset no tocan tareas activas
- Disparos en paralelo: el fire button queda clickable durante tareas (`GENERATING ×N · + fire again`), los pills nunca se deshabilitan (cada fire snapshotea sus valores), debounce 600ms (`fireGate`)
- El canal `higgsfield-progress` emite `{ scope: 'image' | 'video' | 'model', line }` y el renderer enruta cada línea a su log
- `ActivityLog.tsx` compartido: timestamps, colores por línea (✓ verde / error rojo / parcial naranja / ▶∠ accent), auto-scroll stick-to-bottom, Clear, cap 400 líneas; llena el espacio restante (flex-basis 0) junto a PromptOutput — sin espacio muerto
- La pestaña con tarea activa muestra un punto accent pulsante

## IPC handlers (main.ts)
- `generate-prompt` — Claude Sonnet 5 visión → prompt
- `fire-higgsfield` — Higgsfield CLI (solo HF; Gemini removido)
- `fire-poyo-image` — POYO Nano Banana 2 (acepta `imageUrls` pre-subidas)
- `fire-model` — pipeline Model completo (SKU + full body + macro face; NB2 o Recraft)
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