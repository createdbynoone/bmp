import { app, ipcMain, protocol, net, BrowserWindow, Menu, nativeImage, shell, screen, dialog } from "electron";
import { join, extname, dirname } from "path";
import { readFileSync, rmSync, mkdirSync, writeFileSync, createWriteStream, existsSync, copyFileSync, rmdirSync, readdirSync } from "fs";
import { homedir } from "os";
import { execFile, exec, spawn } from "child_process";
import { promisify } from "util";
import { scryptSync, timingSafeEqual } from "crypto";
import https from "https";
import electronUpdater from "electron-updater";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
const { autoUpdater } = electronUpdater;
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-background-networking");
app.commandLine.appendSwitch("disable-features", "MediaRouter,OptimizationGuideModelDownloading,Translate");
const ICON_STYLES = ["Default", "Dark", "ClearLight", "ClearDark", "TintedLight", "TintedDark"];
function prefsPath() {
  return join(app.getPath("userData"), "bmp-prefs.json");
}
function defaultOutputPath() {
  return join(homedir(), "Desktop");
}
function loadPrefs() {
  try {
    const raw = readFileSync(prefsPath(), "utf-8");
    return { iconStyle: "Default", outputPath: defaultOutputPath(), ...JSON.parse(raw) };
  } catch {
    return { iconStyle: "Default", outputPath: defaultOutputPath() };
  }
}
function savePrefs(prefs) {
  writeFileSync(prefsPath(), JSON.stringify(prefs, null, 2), "utf-8");
}
const LOCK_SALT_HEX = "7676d27c96570e2c9bcb3a2efc95ea06";
const LOCK_HASH_HEX = "269de1a03844d8db8f8b154038a158a44bf19b79e309b6eb2c7c7ecf1db6e2b687dc6f34b9a107cebe3f224260b1b58c67324f54be47f0766cc938a1bac8ad31";
const LOCK_HASH = Buffer.from(LOCK_HASH_HEX, "hex");
let unlocked = false;
function verifyPassphrase(attempt) {
  const candidate = scryptSync(attempt, Buffer.from(LOCK_SALT_HEX, "hex"), 64);
  return candidate.length === LOCK_HASH.length && timingSafeEqual(candidate, LOCK_HASH);
}
function currentLockout() {
  return loadPrefs().authLockUntil ?? 0;
}
function registerFailedAttempt() {
  const prefs = loadPrefs();
  const count = (prefs.authFailCount ?? 0) + 1;
  const lockUntil = count >= 3 ? Date.now() + Math.min(5e3 * 2 ** (count - 3), 5 * 60 * 1e3) : 0;
  savePrefs({ ...prefs, authFailCount: count, authLockUntil: lockUntil });
  return lockUntil;
}
function clearAuthState() {
  const prefs = loadPrefs();
  savePrefs({ ...prefs, authFailCount: 0, authLockUntil: 0, unlockedAt: (/* @__PURE__ */ new Date()).toISOString() });
}
function requireUnlocked() {
  if (!unlocked) throw new Error("Locked");
}
function handleWhenUnlocked(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    requireUnlocked();
    return fn(event, ...args);
  });
}
ipcMain.handle("auth:status", () => ({
  locked: !unlocked,
  lockUntil: currentLockout()
}));
ipcMain.handle("auth:unlock", (_e, attempt) => {
  const lockUntil = currentLockout();
  if (Date.now() < lockUntil) return { ok: false, lockUntil };
  if (typeof attempt !== "string" || !verifyPassphrase(attempt)) {
    return { ok: false, lockUntil: registerFailedAttempt() };
  }
  clearAuthState();
  unlocked = true;
  return { ok: true, lockUntil: 0 };
});
const knownLocalPaths = /* @__PURE__ */ new Set();
ipcMain.on("register-known-path", (event, path) => {
  if (typeof path === "string" && path) knownLocalPaths.add(path);
  event.returnValue = true;
});
function stagingRoot() {
  return join(app.getPath("temp"), "bmp-staged-refs");
}
let stagedImageCounter = 0;
function resetStagingDir() {
  try {
    rmSync(stagingRoot(), { recursive: true, force: true });
  } catch {
  }
  mkdirSync(stagingRoot(), { recursive: true });
  stagedImageCounter = 0;
}
handleWhenUnlocked("stage-dropped-files", (_event, { paths }) => {
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > 30) throw new Error("Invalid file input");
  return paths.map((original) => {
    if (typeof original !== "string" || !existsSync(original)) throw new Error(`File not found: ${original}`);
    const ext = extname(original).toLowerCase() || ".jpg";
    stagedImageCounter += 1;
    const staged = join(stagingRoot(), `image${stagedImageCounter}${ext}`);
    copyFileSync(original, staged);
    knownLocalPaths.add(staged);
    return staged;
  });
});
function getIconPath(styleName) {
  const filename = `Icon-macOS-${styleName}-1024@1x.png`;
  if (app.isPackaged) return join(process.resourcesPath, "icons", filename);
  return join(__dirname, "../../build/icons", filename);
}
function applyDockIcon(styleName) {
  if (process.platform !== "darwin") return;
  try {
    const icon = nativeImage.createFromPath(getIconPath(styleName));
    if (!icon.isEmpty()) app.dock?.setIcon(icon);
  } catch {
  }
}
function buildAppMenu() {
  const prefs = loadPrefs();
  const iconSubmenu = ICON_STYLES.map((style) => ({
    label: style,
    type: "radio",
    checked: prefs.iconStyle === style,
    click: () => {
      savePrefs({ ...loadPrefs(), iconStyle: style });
      applyDockIcon(style);
      buildAppMenu();
    }
  }));
  const template = [
    {
      label: app.getName(),
      submenu: [
        { role: "about" },
        { type: "separator" },
        { label: "App Icon", submenu: iconSubmenu },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" }
      ]
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
function memoryPath() {
  return join(app.getPath("userData"), "bmp-memory.json");
}
function loadMemory() {
  try {
    const raw = readFileSync(memoryPath(), "utf-8");
    return JSON.parse(raw);
  } catch {
    return { entries: [] };
  }
}
function saveMemory(memory) {
  writeFileSync(memoryPath(), JSON.stringify(memory, null, 2), "utf-8");
}
function addMemoryEntry(entry) {
  const memory = loadMemory();
  const newEntry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ...entry };
  memory.entries.push(newEntry);
  if (memory.entries.length > 200) memory.entries = memory.entries.slice(-200);
  saveMemory(memory);
  return newEntry;
}
function markFired(id, aspectRatio) {
  const memory = loadMemory();
  const entry = memory.entries.find((e) => e.id === id);
  if (entry) {
    entry.fired = true;
    entry.aspectRatio = aspectRatio;
  }
  saveMemory(memory);
}
function buildMemoryContext() {
  const memory = loadMemory();
  if (memory.entries.length === 0) return "";
  const fired = memory.entries.filter((e) => e.fired).slice(-8);
  const recent = memory.entries.filter((e) => !e.fired).slice(-5);
  const pool = [...fired, ...recent].sort((a, b) => a.timestamp - b.timestamp);
  if (pool.length === 0) return "";
  const lines = pool.map((e) => {
    const label = e.fired ? "★ FIRED" : "○ generated";
    const date = new Date(e.timestamp).toLocaleDateString("es-CO", { month: "short", day: "numeric" });
    return `[${label} · ${date}]
Brief: "${e.description}"
Prompt:
${e.prompt}`;
  }).join("\n\n---\n\n");
  return `

## PROMPT MEMORY — ${pool.length} past Brotherhood prompts (★ = approved & fired to Higgsfield)
Study these to calibrate vocabulary, light descriptions, garment detail depth, color language, and brand tone. Fired prompts are your strongest signal — replicate what makes them work.

${lines}

---
Apply learnings silently. Output ONLY the new prompt.`;
}
const execFileAsync = promisify(execFile);
promisify(exec);
const SHELL_PATH = [
  join(homedir(), ".local/bin"),
  // claude CLI
  "/usr/local/bin",
  "/opt/homebrew/bin",
  "/opt/homebrew/sbin",
  "/usr/bin",
  "/bin",
  process.env.PATH ?? ""
].join(":");
function shellEnv() {
  const env = { ...process.env, PATH: SHELL_PATH };
  delete env.ANTHROPIC_API_KEY;
  return env;
}
function loadEnv() {
  const candidates = [
    join(homedir(), ".bmp.env"),
    app.isPackaged ? join(process.resourcesPath, ".env") : join(__dirname, "../../.env")
  ];
  for (const envPath of candidates) {
    try {
      const raw = readFileSync(envPath, "utf-8");
      for (const line of raw.split("\n")) {
        const [key, ...rest] = line.split("=");
        if (key && rest.length) process.env[key.trim()] = rest.join("=").trim();
      }
      break;
    } catch {
    }
  }
}
loadEnv();
const HF_BIN = "higgsfield";
function higgsfieldCredentialsPath() {
  return join(homedir(), ".config", "higgsfield", "credentials.json");
}
async function higgsfieldJSON(args) {
  const { stdout } = await execFileAsync(HF_BIN, [...args, "--json"], { env: shellEnv(), maxBuffer: 1024 * 1024 * 32 });
  return JSON.parse(stdout);
}
async function ensureWorkspaceSelected() {
  const status = await higgsfieldJSON(["workspace", "status"]).catch(() => null);
  if (status?.id) return;
  const workspaces = await higgsfieldJSON(["workspace", "list"]);
  if (workspaces.length > 0) {
    await execFileAsync(HF_BIN, ["workspace", "set", workspaces[0].id], { env: shellEnv() });
  }
}
function hfArgs(params) {
  const args = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === void 0 || value === null) continue;
    const flag = `--${key.replace(/_/g, "-")}`;
    if (Array.isArray(value)) {
      for (const v of value) args.push(`${flag}=${v}`);
    } else {
      args.push(`${flag}=${value}`);
    }
  }
  return args;
}
async function higgsfieldGenerate(jobType, params, sendProgress) {
  const ids = await higgsfieldJSON(["generate", "create", jobType, ...hfArgs(params)]);
  const jobId = ids[0];
  if (!jobId) throw new Error("Higgsfield: no job id returned");
  let lastStatus = "";
  const startTs = Date.now();
  for (let i = 0; i < 200; i++) {
    await new Promise((r) => setTimeout(r, i === 0 ? 2e3 : 3e3));
    const job = await higgsfieldJSON(["generate", "get", jobId]);
    const elapsed = Math.round((Date.now() - startTs) / 1e3);
    if (job.status !== lastStatus) {
      sendProgress(`${job.status} · ${elapsed}s`);
      lastStatus = job.status;
    }
    if (job.status === "completed") return job;
    if (job.status === "failed") throw new Error("Higgsfield: generation failed (credits refunded)");
    if (job.status === "nsfw") throw new Error("Higgsfield: rejected by content moderation (credits refunded)");
  }
  throw new Error("Timeout — job exceeded 10 minutes");
}
const CLAUDE_MODEL = "claude-sonnet-5";
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
- Keep lighting descriptions neutral — avoid "harsh shadows" on faces, "low-key" alone, or any wording that sounds like surveillance/threat context`;
async function callClaudeCLI(systemPrompt, userPrompt, imagePaths) {
  const uniqueImages = Array.from(new Set(imagePaths));
  const missing = uniqueImages.filter((p) => !existsSync(p));
  if (missing.length > 0) {
    throw new Error(`No se pudo acceder a estas imágenes (¿se movieron, se renombraron, o no están descargadas de iCloud?): ${missing.map((p) => p.split("/").pop()).join(", ")}`);
  }
  const dirs = Array.from(new Set(uniqueImages.map((p) => dirname(p))));
  const args = [
    "-p",
    userPrompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    CLAUDE_MODEL,
    "--system-prompt",
    systemPrompt,
    "--tools",
    "Read",
    "--permission-mode",
    "bypassPermissions",
    "--safe-mode",
    "--no-session-persistence"
  ];
  for (const d of dirs) args.push("--add-dir", d);
  const stdout = await new Promise((resolve, reject) => {
    const child = spawn("claude", args, { env: shellEnv() });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += d;
    });
    child.stderr.on("data", (d) => {
      err += d;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(err.trim() || `claude CLI exited with code ${code}`));
      else resolve(out);
    });
  });
  const readPaths = /* @__PURE__ */ new Set();
  let finalResult = null;
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    let evt;
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }
    if (evt.type === "assistant") {
      for (const block of evt.message?.content ?? []) {
        if (block.type === "tool_use" && block.name === "Read" && typeof block.input?.file_path === "string") {
          readPaths.add(block.input.file_path.normalize("NFC"));
        }
      }
    } else if (evt.type === "result") {
      finalResult = evt;
    }
  }
  if (!finalResult) throw new Error("Claude CLI no devolvió resultado");
  if (finalResult.is_error) throw new Error(finalResult.result || "Claude CLI error");
  const unread = uniqueImages.filter((p) => !readPaths.has(p.normalize("NFC")));
  if (unread.length > 0) {
    throw new Error(`Claude no llegó a ver ${unread.length} imagen(es) antes de generar el prompt: ${unread.map((p) => p.split("/").pop()).join(", ")}. Vuelve a intentar.`);
  }
  return finalResult.result;
}
function imageRefsBlock(label, paths) {
  if (paths.length === 0) return "";
  const lines = paths.map((p, i) => `Image ${i + 1}: ${p}`).join("\n");
  return `## ${label}:
${lines}

`;
}
const GENERATE_COOLDOWN_MS = 4e3;
let lastGenerateTime = 0;
handleWhenUnlocked("generate-prompt", async (_event, { refs, products, description }) => {
  const now = Date.now();
  if (now - lastGenerateTime < GENERATE_COOLDOWN_MS) {
    const wait = Math.ceil((GENERATE_COOLDOWN_MS - (now - lastGenerateTime)) / 1e3);
    throw new Error(`Rate limit: wait ${wait}s before generating again`);
  }
  lastGenerateTime = now;
  if (typeof description !== "string" || description.trim().length === 0 || description.length > 2e3) {
    throw new Error("Invalid description");
  }
  if (!Array.isArray(refs) || !Array.isArray(products) || refs.length > 30 || products.length > 30) {
    throw new Error("Invalid file input");
  }
  const systemWithMemory = SYSTEM_PROMPT + buildMemoryContext();
  const uniqueImageCount = (/* @__PURE__ */ new Set([...refs, ...products])).size;
  const userPrompt = imageRefsBlock("REFERENCE IMAGES (composition/mood)", refs) + imageRefsBlock("PRODUCT PHOTOS (Brotherhood garment)", products) + `## USER BRIEF:
${description}

You MUST call the Read tool once for each of the ${uniqueImageCount} image path(s) listed above before writing anything — do not skip any, do not infer content from filenames alone. Only after viewing every image, generate the NanaBanana2 marketing prompt.`;
  const prompt = await callClaudeCLI(systemWithMemory, userPrompt, [...refs, ...products]);
  const entry = addMemoryEntry({ timestamp: Date.now(), description, prompt, fired: false });
  return { prompt, memoryId: entry.id };
});
handleWhenUnlocked("mark-prompt-fired", (_event, { id, aspectRatio }) => {
  markFired(id, aspectRatio);
});
handleWhenUnlocked("get-version", () => app.getVersion());
handleWhenUnlocked("get-output-path", () => loadPrefs().outputPath);
handleWhenUnlocked("set-output-path", (_event, path) => {
  if (typeof path !== "string" || path.length === 0) throw new Error("Invalid path");
  savePrefs({ ...loadPrefs(), outputPath: path });
});
handleWhenUnlocked("open-folder-dialog", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
    title: "Choose output folder"
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});
handleWhenUnlocked("get-memory-stats", () => {
  const memory = loadMemory();
  return {
    total: memory.entries.length,
    fired: memory.entries.filter((e) => e.fired).length
  };
});
handleWhenUnlocked("get-memory-entries", () => {
  const memory = loadMemory();
  return [...memory.entries].reverse();
});
handleWhenUnlocked("check-higgsfield-auth", async () => {
  if (!existsSync(higgsfieldCredentialsPath())) return { authenticated: false };
  try {
    await ensureWorkspaceSelected();
    return { authenticated: true };
  } catch {
    return { authenticated: false };
  }
});
handleWhenUnlocked("higgsfield-login", async () => {
  try {
    await execFileAsync(HF_BIN, ["auth", "login"], { env: shellEnv(), timeout: 12e4 });
    await ensureWorkspaceSelected();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});
function downloadFile(url, destPath) {
  if (!url.startsWith("https://")) return Promise.reject(new Error("Only HTTPS downloads are allowed"));
  return new Promise((resolve, reject) => {
    const file = createWriteStream(destPath);
    https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
        return;
      }
      res.pipe(file);
      file.on("finish", () => file.close(() => resolve()));
      file.on("error", reject);
    }).on("error", reject);
  });
}
function downloadDmgWithProgress(url, destPath, token, onProgress) {
  if (!url.startsWith("https://")) return Promise.reject(new Error("Only HTTPS downloads are allowed"));
  return new Promise((resolve, reject) => {
    const attempt = (attemptUrl) => {
      if (!attemptUrl.startsWith("https://")) {
        reject(new Error("Redirect to non-HTTPS blocked"));
        return;
      }
      const parsed = new URL(attemptUrl);
      const headers = {};
      https.get({ hostname: parsed.hostname, path: parsed.pathname + parsed.search, headers }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          attempt(res.headers.location);
          return;
        }
        const total = parseInt(res.headers["content-length"] ?? "0", 10);
        let received = 0;
        const file = createWriteStream(destPath);
        res.on("data", (chunk) => {
          received += chunk.length;
          if (total > 0) onProgress(Math.round(received / total * 100));
        });
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve()));
        file.on("error", reject);
      }).on("error", reject);
    };
    attempt(url);
  });
}
handleWhenUnlocked("get-higgsfield-credits", async () => {
  try {
    const status = await higgsfieldJSON(["account", "status"]);
    return { credits: status.credits, plan: status.subscription_plan_type };
  } catch {
    return { credits: null, plan: null };
  }
});
const IMAGE_RATIOS = ["4:5", "9:16"];
const MODEL_RATIOS = ["9:16", "4:5", "1:1", "16:9"];
const IMAGE_PROVIDERS = {
  seedream: { jobType: "seedream_v5_pro", resolutions: ["1k", "2k"], maxRefs: 10 },
  nanobanana: { jobType: "nano_banana_pro", resolutions: ["1k", "2k", "4k"], maxRefs: 14 }
};
handleWhenUnlocked("upload-poyo-refs", async (event, { products }) => {
  if (!Array.isArray(products)) throw new Error("Invalid products");
  const sendProgress = (line) => event.sender.send("higgsfield-progress", { scope: "image", line });
  const MAX_REFS = 14;
  let files = products;
  if (files.length > MAX_REFS) {
    sendProgress(`Higgsfield accepts max ${MAX_REFS} reference images — using the first ${MAX_REFS}`);
    files = files.slice(0, MAX_REFS);
  }
  sendProgress(`Uploading ${files.length} image${files.length > 1 ? "s" : ""}...`);
  const urls = await Promise.all(files.map((f) => higgsfieldJSON(["upload", "create", f]).then((r) => r.id)));
  sendProgress(`${files.length} image${files.length > 1 ? "s" : ""} ready ✓`);
  return { urls };
});
handleWhenUnlocked("fire-poyo-image", async (event, { prompt, products, aspectRatio, resolution, provider, imageUrls: presetUrls }) => {
  if (typeof prompt !== "string" || prompt.trim().length === 0) throw new Error("Invalid prompt");
  if (!Array.isArray(products)) throw new Error("Invalid products");
  if (presetUrls !== void 0 && (!Array.isArray(presetUrls) || presetUrls.some((u) => typeof u !== "string"))) throw new Error("Invalid imageUrls");
  const providerKey = provider === "seedream" ? "seedream" : "nanobanana";
  const providerCfg = IMAGE_PROVIDERS[providerKey];
  const timestamp = Date.now();
  const desktopPath = loadPrefs().outputPath;
  const sendProgress = (line) => event.sender.send("higgsfield-progress", { scope: "image", line });
  const safeSize = IMAGE_RATIOS.includes(aspectRatio) ? aspectRatio : "4:5";
  const allowedResolutions = providerCfg.resolutions;
  const safeRes = (allowedResolutions.includes(resolution) ? resolution : allowedResolutions[allowedResolutions.length - 1]).toLowerCase();
  let refs = (presetUrls ?? []).slice(0, providerCfg.maxRefs);
  if (refs.length === 0 && products.length > 0) {
    if (products.length > providerCfg.maxRefs) {
      sendProgress(`${providerKey === "seedream" ? "Seedream" : "Nano Banana Pro"} accepts max ${providerCfg.maxRefs} reference images — using the first ${providerCfg.maxRefs}`);
    }
    refs = products.slice(0, providerCfg.maxRefs);
  }
  sendProgress(`Submitting ${providerCfg.jobType} (${safeSize} · ${safeRes.toUpperCase()})...`);
  try {
    const job = await higgsfieldGenerate(providerCfg.jobType, {
      prompt,
      aspect_ratio: safeSize,
      resolution: safeRes,
      image_references: refs.length > 0 ? refs : void 0
    }, sendProgress);
    const url = job.result_url;
    if (!url) {
      sendProgress("No image in response");
      return { success: false, outputPath: "", error: "No image file" };
    }
    const ext = url.split(".").pop()?.split("?")[0] ?? "jpg";
    const outputName = `bmp_${timestamp}.${ext}`;
    const outputPath = join(desktopPath, outputName);
    sendProgress("Downloading image...");
    await downloadFile(url, outputPath);
    knownLocalPaths.add(outputPath);
    try {
      const { stdout } = await execFileAsync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", outputPath]);
      const w = stdout.match(/pixelWidth:\s*(\d+)/)?.[1];
      const h = stdout.match(/pixelHeight:\s*(\d+)/)?.[1];
      sendProgress(`Saved: ${outputName}${w && h ? ` · ${w}×${h}px` : ""}`);
    } catch {
      sendProgress(`Saved: ${outputName}`);
    }
    return { success: true, outputPath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendProgress(`Error: ${msg}`);
    return { success: false, outputPath: "", error: msg };
  }
});
const MODELS_DIR = "/Volumes/Sandisk Home/Brotherhood/IA/Modelos";
const MACRO_FACE_PROMPT = `Macro beauty close-up of the EXACT same person from the reference image — preserve identical facial features, bone structure, skin tone, eye color, eyebrows, hairstyle and any visible styling exactly as shown. Tight portrait framing from forehead to chin filling the frame, face centered, eyes locked direct to lens in razor-sharp focus. Ultra-detailed natural skin texture: visible pores, fine vellus hair, natural micro-imperfections and subtle sheen — no airbrushing. Individual eyelashes and brow hairs resolved, natural lip texture. Soft wraparound beauty-dish light with clean catchlights in both eyes, gentle falloff, seamless neutral studio backdrop dissolving out of focus. Shot on Sony A7R IV, 90mm macro lens at f/4, shallow depth of field. Ultra-realistic commercial beauty campaign photography.`;
const reservedSkus = /* @__PURE__ */ new Set();
function allocateSku(gender) {
  const prefix = gender === "male" ? "SMM" : "SMF";
  const genderDir = join(MODELS_DIR, prefix);
  mkdirSync(genderDir, { recursive: true });
  const rx = new RegExp(`^${prefix}(\\d{3,})$`);
  const used = readdirSync(genderDir).map((n) => n.match(rx)?.[1]).filter((n) => n !== void 0).map(Number);
  for (const s of reservedSkus) {
    const m = s.match(rx);
    if (m) used.push(Number(m[1]));
  }
  const sku = `${prefix}${String((used.length > 0 ? Math.max(...used) : 0) + 1).padStart(3, "0")}`;
  reservedSkus.add(sku);
  const dir = join(genderDir, sku);
  mkdirSync(dir, { recursive: true });
  return { sku, dir };
}
async function sendSavedLine(outputPath, sendProgress) {
  const name = outputPath.split("/").pop() ?? outputPath;
  try {
    const { stdout } = await execFileAsync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", outputPath]);
    const w = stdout.match(/pixelWidth:\s*(\d+)/)?.[1];
    const h = stdout.match(/pixelHeight:\s*(\d+)/)?.[1];
    sendProgress(`Saved: ${name}${w && h ? ` · ${w}×${h}px` : ""}`);
  } catch {
    sendProgress(`Saved: ${name}`);
  }
}
async function higgsfieldGenerateToFile(opts) {
  const { jobType, params, destDir, baseName, sendProgress } = opts;
  const job = await higgsfieldGenerate(jobType, params, sendProgress);
  const url = job.result_url;
  if (!url) throw new Error("No image file in response");
  const urlExt = url.split(".").pop()?.split("?")[0]?.toLowerCase();
  const ext = urlExt && urlExt.length <= 4 ? urlExt : "jpg";
  const outputPath = join(destDir, `${baseName}.${ext}`);
  sendProgress("Downloading image...");
  await downloadFile(url, outputPath);
  knownLocalPaths.add(outputPath);
  await sendSavedLine(outputPath, sendProgress);
  return outputPath;
}
handleWhenUnlocked("fire-model", async (event, { prompt, engine, aspectRatio, resolution, gender }) => {
  if (typeof prompt !== "string" || prompt.trim().length === 0 || prompt.length > 1e4) throw new Error("Invalid prompt");
  const sendProgress = (line) => event.sender.send("higgsfield-progress", { scope: "model", line });
  const safeGender = gender === "male" ? "male" : "female";
  const safeEngine = engine === "recraft" ? "recraft" : "nb2";
  const safeSize = MODEL_RATIOS.includes(aspectRatio) ? aspectRatio : "4:5";
  const recraftResolutions = ["1k", "2k"];
  const nb2Resolutions = ["1k", "2k", "4k"];
  const safeRes = safeEngine === "recraft" ? recraftResolutions.includes(resolution) ? resolution : "2k" : nb2Resolutions.includes(resolution) ? resolution : "2k";
  let sku;
  let dir;
  try {
    ({ sku, dir } = allocateSku(safeGender));
  } catch (err) {
    const msg = `Cannot access ${MODELS_DIR} — ${err instanceof Error ? err.message : String(err)}`;
    sendProgress(msg);
    return { success: false, sku: "", outputPath: "", facePath: "", error: msg };
  }
  sendProgress(`SKU ${sku} · Modelos/${safeGender === "male" ? "SMM" : "SMF"}/${sku}/`);
  try {
    let fullPath;
    try {
      if (safeEngine === "recraft") {
        sendProgress(`Submitting Recraft V4.1 (${safeSize} · ${safeRes.toUpperCase()})...`);
        fullPath = await higgsfieldGenerateToFile({
          jobType: "recraft_v4_1",
          params: { prompt, aspect_ratio: safeSize, resolution: safeRes },
          destDir: dir,
          baseName: sku,
          sendProgress
        });
      } else {
        sendProgress(`Submitting Nano Banana Pro (${safeSize} · ${safeRes.toUpperCase()})...`);
        fullPath = await higgsfieldGenerateToFile({
          jobType: "nano_banana_pro",
          params: { prompt, aspect_ratio: safeSize, resolution: safeRes },
          destDir: dir,
          baseName: sku,
          sendProgress
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendProgress(`Error: ${msg}`);
      try {
        rmdirSync(dir);
      } catch {
      }
      return { success: false, sku, outputPath: "", facePath: "", error: msg };
    }
    let facePath = "";
    let faceError;
    try {
      sendProgress("▶ Macro face shot...");
      facePath = await higgsfieldGenerateToFile({
        jobType: "nano_banana_pro",
        params: { prompt: MACRO_FACE_PROMPT, aspect_ratio: "4:5", resolution: "2k", image_references: [fullPath] },
        destDir: dir,
        baseName: `${sku}_FACE`,
        sendProgress
      });
    } catch (err) {
      faceError = err instanceof Error ? err.message : String(err);
      sendProgress(`Face macro failed — ${faceError}`);
    }
    if (facePath) sendProgress(`${sku} complete ✓ — full body + face macro`);
    return { success: true, sku, outputPath: fullPath, facePath, error: faceError };
  } finally {
    reservedSkus.delete(sku);
  }
});
handleWhenUnlocked("fire-video", async (event, { prompt, products: frames, videoModel, aspectRatio, resolution, duration }) => {
  if (typeof prompt !== "string" || prompt.trim().length === 0) throw new Error("Invalid prompt");
  if (!Array.isArray(frames) || frames.length > 9) throw new Error("Invalid frames");
  const timestamp = Date.now();
  const desktopPath = loadPrefs().outputPath;
  const sendProgress = (line) => event.sender.send("higgsfield-progress", { scope: "video", line });
  const tagRefs = [...prompt.matchAll(/@Image(\d+)/gi)].map((m) => parseInt(m[1]));
  const maxTag = tagRefs.length > 0 ? Math.max(...tagRefs) : 0;
  if (maxTag > frames.length) {
    sendProgress(`Warning: prompt references @Image${maxTag} but only ${frames.length} frame${frames.length !== 1 ? "s" : ""} provided`);
  }
  const safeRes = ["720p", "1080p"].includes(resolution) ? resolution : "720p";
  const vidRatio = aspectRatio === "auto" ? "auto" : aspectRatio === "9:16" ? "9:16" : "16:9";
  const mode = videoModel === "seedance-2-fast" ? "fast" : "std";
  sendProgress(`Submitting Seedance 2.0 (${aspectRatio} · ${resolution} · ${duration}s)...`);
  try {
    const job = await higgsfieldGenerate("seedance_2_0", {
      prompt,
      aspect_ratio: vidRatio,
      resolution: safeRes,
      duration,
      mode,
      generate_audio: false,
      image_references: frames.length > 0 ? frames : void 0
    }, sendProgress);
    const videoUrl = job.result_url;
    if (!videoUrl) {
      sendProgress("No video file in response");
      return { success: false, outputPath: "", error: "No video file" };
    }
    const outputName = `bmp_video_${timestamp}.mp4`;
    const outputPath = join(desktopPath, outputName);
    sendProgress("Downloading video...");
    await downloadFile(videoUrl, outputPath);
    sendProgress(`Saved: ${outputName}`);
    return { success: true, outputPath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendProgress(`Error: ${msg}`);
    return { success: false, outputPath: "", error: msg };
  }
});
function initialWindowSize() {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.round(Math.min(Math.max(screenW * 0.48, 800), 1100));
  const height = Math.round(Math.min(Math.max(screenH * 0.72, 600), 860));
  return { width, height };
}
function createWindow() {
  const win = new BrowserWindow({
    ...initialWindowSize(),
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#0c0c0c",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, "../preload/preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Was 1.1 (+10% UI) — now 0.95 (-5% off native), shrinking the whole
      // interface a bit further; window sizing above does the screen-adaptive
      // work a manual zoom hack used to approximate.
      zoomFactor: 0.95,
      spellcheck: false
    }
  });
  win.webContents.on("did-finish-load", () => {
    win.webContents.setZoomFactor(0.95);
  });
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }
  return win;
}
protocol.registerSchemesAsPrivileged([
  { scheme: "localfile", privileges: { secure: true, supportFetchAPI: true, bypassCSP: true } }
]);
async function installFromDmg(dmgPath) {
  const { stdout } = await execFileAsync("hdiutil", ["attach", dmgPath, "-nobrowse", "-plist"], { env: shellEnv() });
  const mountMatch = stdout.match(/<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/);
  if (!mountMatch) throw new Error("DMG mount point not found");
  const mountPoint = mountMatch[1].trim();
  try {
    await execFileAsync("ditto", [`${mountPoint}/BMP.app`, "/Applications/BMP.app"], { env: shellEnv() });
  } finally {
    await execFileAsync("hdiutil", ["detach", mountPoint, "-quiet", "-force"], { env: shellEnv() }).catch(() => {
    });
  }
}
function setupAutoUpdater(win) {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  const notify = (payload) => win.webContents.send("update-status", payload);
  autoUpdater.on("update-available", (info) => {
    notify({ phase: "available", version: info.version });
    const arch = process.arch === "arm64" ? "-arm64" : "";
    const filename = `BMP-${info.version}${arch}.dmg`;
    const dmgUrl = `https://github.com/createdbynoone/bmp/releases/download/v${info.version}/${filename}`;
    const tmpPath = join(app.getPath("temp"), filename);
    downloadDmgWithProgress(dmgUrl, tmpPath, void 0, (percent) => {
      notify({ phase: "downloading", percent, version: info.version });
    }).then(async () => {
      notify({ phase: "installing", version: info.version });
      await installFromDmg(tmpPath);
      notify({ phase: "ready", version: info.version });
      setTimeout(() => {
        app.relaunch();
        app.quit();
      }, 1500);
    }).catch(async (err) => {
      notify({ phase: "error", error: `Auto-install fallido, abriendo DMG: ${err.message}` });
      const desktopPath = join(homedir(), "Desktop", filename);
      try {
        await downloadFile(dmgUrl, desktopPath);
        await shell.openPath(desktopPath);
      } catch {
      }
    });
  });
  autoUpdater.on("error", (err) => {
    notify({ phase: "error", error: err.message });
  });
  win.webContents.once("did-finish-load", () => autoUpdater.checkForUpdates());
}
app.whenReady().then(() => {
  resetStagingDir();
  protocol.handle("localfile", (request) => {
    const filePath = decodeURIComponent(request.url.slice("localfile://".length));
    if (!unlocked || !knownLocalPaths.has(filePath)) {
      return new Response("Forbidden", { status: 403 });
    }
    return net.fetch(`file://${filePath}`);
  });
  unlocked = Boolean(loadPrefs().unlockedAt);
  buildAppMenu();
  applyDockIcon(loadPrefs().iconStyle);
  const win = createWindow();
  setupAutoUpdater(win);
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
