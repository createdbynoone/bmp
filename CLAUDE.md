# BMP — Brotherhood Marketing Prompts

Electron app para generar prompts de marketing de prendas Brotherhood y dispararlos a providers de imagen/video.

**Dev:** `npm run dev`
**Release:** `bash scripts/publish.sh` (build local + subida via gh — ver sección Release)
**Versión actual:** `1.12.0` (2026-09-09: proveedor de imagen/video migrado de Runware a **Higgsfield** — vía el CLI oficial `@higgsfield/cli` como subproceso, no API key propia; mismos 4 modelos ahora servidos directo por Higgsfield (Seedream 5.0 Pro, Nano Banana Pro, Recraft V4.1, Seedance 2.0); ver sección Higgsfield CLI abajo) · (2026-08-06: proveedor migrado de POYO a Runware) · (2026-07-24: Image tab migrado a Seedream 5.0 Pro / Nano Banana Pro — Higgsfield CLI standalone removido en ese momento, reintroducido en v1.12.0 como backend; ratios 4:5/9:16 only; RAM más liviana — sin GPU process, sin spellcheck, sin background networking de Chromium; ventana con tamaño dinámico por pantalla y zoomFactor 0.95)

## Lock screen + seguridad (v1.6.0, 2026-07-07)
- Primer arranque en una máquina pide passphrase (`brother*1998_hood`, mismo patrón que Brotherhood Canvas/Sorter/Product Builder) antes de tocar filesystem/API keys — scrypt hash+salt propios en `main.ts`, nunca el texto plano; `timingSafeEqual`; backoff exponencial persistido en `bmp-prefs.json`
- `handleWhenUnlocked()` gatea todos los IPC (`generate-prompt`, `fire-poyo-image`, `fire-video`, `upload-poyo-refs`, `get-memory-entries`, etc.)
- **Vulnerabilidad real corregida**: el protocolo `localfile://` hacía `net.fetch('file://' + path)` con CUALQUIER path, sin restricción. Ahora `knownLocalPaths` (Set poblado por el wrapper de `getPathForFile` en preload) es el único conjunto de paths servibles, y solo si `unlocked`
- CSP agregado a `index.html` (no existía)
- Para regenerar el hash si cambia la clave: `node -e "const c=require('crypto');const s=c.randomBytes(16);console.log(s.toString('hex'), c.scryptSync('NUEVA_CLAVE',s,64).toString('hex'))"` y reemplazar `LOCK_SALT_HEX`/`LOCK_HASH_HEX`

## Stack
- Electron 43 + electron-vite 5 + vite 7 + React 18 + Tailwind
- electron-builder 26 (DMG + ZIP, arm64 + x64) — **el tag debe existir en el remoto antes de publicar** (422 "valid tag" si no)
- electron-updater 6
- @anthropic-ai/sdk 0.109+ (`claude-sonnet-5` con visión, constante `CLAUDE_MODEL` en main.ts) — <0.40 rompe en Electron 43 (gunzip "Premature close")
- **Electron 32+ eliminó `File.path`** — drag & drop usa `webUtils.getPathForFile()` expuesto como `window.bmp.getPathForFile`
- zoomFactor 0.95 global (era 1.1/+10%, reducido 2026-07-24 a -5%) — tamaño inicial dinámico vía `initialWindowSize()` (48%/72% del `workAreaSize` de la pantalla, clamp 800×600–1100×860); will-navigate prevented + setWindowOpenHandler deny
- Contraste: text-secondary #9A9A9A / text-muted #666666; titlebar h-11 alineado a semáforos

## Modos

### Image (`[SEEDREAM | NB PRO]`) — vía Higgsfield (2026-09-09; antes Runware)
Ratios unificados para ambos providers: **4:5 / 9:16** (default 4:5)
| Provider | job_type Higgsfield | Resoluciones | Refs max | Variaciones |
|---|---|---|---|---|
| SEEDREAM | `seedream_v5_pro` | 1K / 2K | 10 | ×1–4 |
| NB PRO (default) | `nano_banana_pro` | 1K / 2K / 4K | 14 | ×1–4 |

Un solo job_type sirve texto→imagen e imagen→imagen — la diferencia es si `image_references` viene poblado. `image_references` acepta paths locales directamente (`generate create` los auto-sube), así que `upload-poyo-refs` llama `higgsfield upload create <path>` una vez por archivo y comparte los upload-ids devueltos entre disparos paralelos (variaciones) — el nombre del IPC quedó igual por compat con preload/renderer. Sin ese pre-upload, `fire-poyo-image` pasa los paths crudos y deja que el CLI los suba él mismo.

### Model (`[NB2 | RECRAFT]`) — creación de modelos de IA (2026-07-10)
- El usuario PEGA el prompt manualmente (Claude no lo genera); sin imágenes de referencia
- Engines: NB2 (Higgsfield `nano_banana_pro`, 1K/2K/4K) o **Recraft V4.1** (Higgsfield `recraft_v4_1`, 1K/2K)
- **Pipeline completo en IPC `fire-model`** (main.ts): asigna SKU → genera full body → dispara automáticamente un **macro face shot** con `nano_banana_pro` (`image_references: [fullPath]`) usando el render recién generado como referencia de identidad (misma cara) y el preset `MACRO_FACE_PROMPT` (gender-neutral, 4:5 · 2K)
- **SKU + carpetas**: `SMF###` (female) / `SMM###` (male) en `/Volumes/Sandisk Home/Brotherhood/IA/Modelos/SMF|SMM/<SKU>/` con `<SKU>.<ext>` + `<SKU>_FACE.<ext>`; numeración auto-incremental escaneando la carpeta + `reservedSkus` (Set) contra carreras de fires paralelos; si la generación principal falla se hace `rmdirSync` del folder vacío
- Toggle `SMF | SMM` en la barra inferior con auto-detección de género desde el prompt (`detectGender` en App.tsx — "woman" nunca matchea `\bman\b`); el toggle siempre puede overridear
- Resultados: cards por SKU en `ModelMode.tsx` con FULL + FACE lado a lado y lightbox — main agrega outputs a `knownLocalPaths` para servirlos via `localfile://`
- Si el face macro falla, el resultado principal se conserva (success parcial con `error` y placeholder "face macro failed" en la card)

### Video (Seedance 2.0 / Higgsfield)
- El usuario escribe el prompt manualmente
- Frames drag & drop (max 9) → referenciados con `@Image1`, `@Image2`... → van en `image_references` (orden preservado por flags repetidos, no hay semántica first/last-frame salvo que se use `start_image`/`end_image` explícitos, que no se usan aquí)
- `mode`: `seedance-2` → `std` (PRO) / `seedance-2-fast` → `fast`
- Ratios: 9:16 / 16:9 / auto (Higgsfield deriva el ratio de los frames server-side cuando es `auto` — sin sniffing local de dimensiones) | Resoluciones: 720p / 1080p | Duración: 5/10/15s
- Audio SIEMPRE apagado (`generate_audio: false` hardcoded en fire-video; toggle removido de la UI)

## Higgsfield CLI (migrado de Runware 2026-09-09)
Sin API key propia — auth es login OAuth de un solo uso con el CLI oficial (`npm i -g @higgsfield/cli`, binario `higgsfield`/`higgs`/`hf`), facturado contra el plan/créditos de la cuenta del usuario. Mismo patrón que `callClaudeCLI` (la CLI de `claude` para prompts), solo que para imagen/video.
```
higgsfield auth login                    # OAuth PKCE, abre navegador, guarda ~/.config/higgsfield/credentials.json
higgsfield workspace set <id>             # necesario una vez — sin esto, todo falla con "No workspace selected"
higgsfield generate create <job_type> --json [--param=value]... [--image-references=<path o upload-id>]...
higgsfield generate get <job_id> --json   # poll manual — status: queued → in_progress → completed|failed|nsfw
higgsfield upload create <path> --json    # sube un archivo, devuelve { id, url } reusable como image_references
higgsfield account status --json          # { credits, subscription_plan_type }
```
`higgsfieldJSON()`/`higgsfieldGenerate()` en main.ts envuelven esto: `generate create` sin `--wait` (control propio del progreso) → poll `generate get` cada ~3s, 10 min timeout, mismo shape que el polling viejo de Runware. **Los flags van con `=` (`--flag=value`), nunca espacio** — pflag/cobra no consume de forma confiable un `"true"/"false"` separado por espacio en flags booleanos (`generate_audio`, `remove_bg`, `is_inpaint`). Una sesión OAuth recién logueada no tiene workspace seleccionado — `ensureWorkspaceSelected()` autoselecciona el primero (las cuentas solo tienen uno).

Job types usados por BMP y sus params clave (`higgsfield model get <job_type>` para el schema completo): `seedream_v5_pro` (aspect_ratio, resolution 1k/1.5k/2k, image_references max 10), `nano_banana_pro` (aspect_ratio, resolution 1k/2k/4k, image_references max 14), `recraft_v4_1` (aspect_ratio, resolution 1k/2k, model_type — sin soporte de referencia), `seedance_2_0` (aspect_ratio incluye `auto`, resolution hasta 4k, mode std/fast, duration 4-15s, image_references + start_image/end_image, generate_audio).

## Shared utilities (main.ts)
- `higgsfieldJSON` — `execFile('higgsfield', [...args, '--json'])`, parsea stdout
- `hfArgs` — serializa un objeto de params a `--flag=value` (arrays → flag repetido, orden preservado)
- `higgsfieldGenerate` — `generate create` (sin --wait) → poll `generate get` hasta `completed`/`failed`/`nsfw`
- `higgsfieldGenerateToFile` — corre `higgsfieldGenerate` y descarga `result_url` a `destDir/baseName.<ext>`

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
- `generate-prompt` — Claude Sonnet 5 vía CLI (`claude -p --tools Read`, no SDK) → prompt. `callClaudeCLI` usa `--output-format stream-json` para contar qué paths tocó el Read tool y comparar contra las imágenes enviadas; si alguna quedó sin leer, revienta con error explícito en vez de devolver un prompt que nunca vio esa referencia (v1.11.0, 2026-08-20: bug real en producción — un nombre de archivo tipo captura de pantalla macOS con paréntesis/puntos hacía que Claude no la leyera, y con `--output-format json` eso pasaba silencioso)
- `stage-dropped-files` — copia cada archivo soltado a `$TMPDIR/bmp-staged-refs/imageN.ext` antes de que su path llegue a `refs`/`products`; Claude nunca ve el nombre original (evita bias por nombre descriptivo/basura y el mismatch NFC/NFD de tildes en macOS). Reset del contador + carpeta en cada arranque (`resetStagingDir` en `app.whenReady`)
- `fire-poyo-image` — Higgsfield Seedream 5.0 Pro / Nano Banana Pro (acepta `provider` + `imageUrls` pre-preparadas; nombre del canal quedó igual por compat, viene de la era POYO)
- `fire-model` — pipeline Model completo (SKU + full body + macro face; NB2 o Recraft, ambos vía Higgsfield)
- `upload-poyo-refs` — sube refs una vez vía `higgsfield upload create`, retorna upload-ids para fan-out paralelo (nombre legado, ver arriba)
- `fire-video` — Higgsfield Seedance 2.0
- `check-higgsfield-auth` — existe `~/.config/higgsfield/credentials.json` + workspace seleccionable
- `higgsfield-login` — corre `higgsfield auth login` (abre navegador) y autoselecciona workspace
- `get-higgsfield-credits` — `higgsfield account status`
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