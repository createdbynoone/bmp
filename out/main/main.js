import { ipcMain, protocol, app, net, BrowserWindow, Menu, nativeImage, shell, dialog } from "electron";
import { join } from "path";
import { readFileSync, writeFileSync, createWriteStream, rmdirSync, mkdirSync, readdirSync, renameSync, unlinkSync } from "fs";
import { homedir } from "os";
import { execFile, exec } from "child_process";
import { promisify } from "util";
import { scryptSync, timingSafeEqual } from "crypto";
import https from "https";
import Anthropic from "@anthropic-ai/sdk";
import electronUpdater from "electron-updater";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
const { autoUpdater } = electronUpdater;
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
  "/usr/local/bin",
  "/opt/homebrew/bin",
  "/opt/homebrew/sbin",
  "/usr/bin",
  "/bin",
  process.env.PATH ?? ""
].join(":");
function shellEnv() {
  return { ...process.env, PATH: SHELL_PATH };
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
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
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
const MAX_IMAGE_PX = 1568;
function resizeAndEncode(p) {
  try {
    const img = nativeImage.createFromPath(p);
    if (!img.isEmpty()) {
      const { width, height } = img.getSize();
      const scale = Math.min(1, MAX_IMAGE_PX / Math.max(width, height));
      const resized = scale < 1 ? img.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: "good" }) : img;
      const b642 = resized.toJPEG(85).toString("base64");
      if (b642) return { b64: b642, mediaType: "image/jpeg" };
    }
    const raw = readFileSync(p);
    const ext = p.split(".").pop()?.toLowerCase() ?? "";
    const mediaType = ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : ext === "webp" ? "image/webp" : "image/jpeg";
    const b64 = raw.toString("base64");
    if (!b64) return null;
    return { b64, mediaType };
  } catch {
    return null;
  }
}
function filesToVisionContent(paths) {
  return paths.map((p) => resizeAndEncode(p)).filter((r) => r !== null && r.b64.length > 0).map(({ b64, mediaType }) => ({
    type: "image",
    source: { type: "base64", media_type: mediaType, data: b64 }
  }));
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
  const refImages = filesToVisionContent(refs);
  const productImages = filesToVisionContent(products);
  const systemWithMemory = SYSTEM_PROMPT + buildMemoryContext();
  const userContent = [
    { type: "text", text: "## REFERENCE IMAGES (composition/mood):" },
    ...refImages,
    { type: "text", text: "## PRODUCT PHOTOS (Brotherhood garment):" },
    ...productImages,
    {
      type: "text",
      text: `## USER BRIEF:
${description}

Generate the NanaBanana2 marketing prompt now.`
    }
  ];
  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system: systemWithMemory,
    messages: [{ role: "user", content: userContent }]
  });
  const block = message.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type");
  const prompt = block.text;
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
  return { authenticated: !!process.env.POYO_API_KEY };
});
handleWhenUnlocked("higgsfield-login", async () => {
  return { ok: false, error: "Add POYO_API_KEY to ~/.bmp.env" };
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
  return { credits: null, plan: "nano-banana-2" };
});
const HF_VALID_RESOLUTIONS = ["1k", "2k"];
const HF_VALID_ASPECT_RATIOS = ["9:16", "4:5", "1:1", "16:9", "1:2", "2:1"];
handleWhenUnlocked("fire-higgsfield", async (event, { prompt, aspectRatio, products, resolution }) => {
  if (typeof prompt !== "string" || prompt.trim().length === 0 || prompt.length > 12e3) {
    throw new Error("Invalid prompt");
  }
  if (!Array.isArray(products) || products.length > 30) throw new Error("Invalid products");
  const sendProgress = (line) => event.sender.send("higgsfield-progress", { scope: "image", line });
  const timestamp = Date.now();
  const desktopPath = loadPrefs().outputPath;
  const safeRes = HF_VALID_RESOLUTIONS.includes(resolution) ? resolution : "1k";
  const safeRatio = HF_VALID_ASPECT_RATIOS.includes(aspectRatio) ? aspectRatio : "4:5";
  sendProgress("Starting Higgsfield generation...");
  const args = [
    "generate",
    "create",
    "nano_banana_2",
    "--prompt",
    prompt,
    "--resolution",
    safeRes || "1k",
    "--aspect_ratio",
    safeRatio || "4:5",
    "--wait"
  ];
  if (products.length > 0) {
    for (const p of products) args.push("--image", p);
    sendProgress(`Uploading ${products.length} product image${products.length > 1 ? "s" : ""} as reference...`);
  }
  try {
    const { stdout, stderr } = await execFileAsync("higgsfield", args, { timeout: 3e5, env: shellEnv() });
    const combined = (stdout + "\n" + stderr).trim();
    if (combined) sendProgress(combined);
    const cliError = combined.match(/\b(error|failed|failure|rejected|content.?policy|moderat|violat|unsafe|prohibited)\b/i);
    if (cliError) {
      const snippet = combined.slice(0, 200);
      sendProgress(`Generation failed — ${snippet}`);
      return { success: false, outputPath: "", error: snippet };
    }
    const urlMatch = combined.match(/https:\/\/\S+\.(png|jpg|jpeg|webp)/i);
    if (urlMatch) {
      const imageUrl = urlMatch[0];
      const ext = imageUrl.split(".").pop()?.split("?")[0] ?? "jpg";
      const outputName = `bmp_${timestamp}.${ext}`;
      const outputPath = join(desktopPath, outputName);
      sendProgress("Downloading to Desktop...");
      await downloadFile(imageUrl, outputPath);
      sendProgress(`Saved: ${outputName}`);
      return { success: true, outputPath };
    }
    sendProgress("Generation failed — no image URL in CLI output");
    return { success: false, outputPath: "", error: "No image URL in output" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendProgress(`Error: ${msg}`);
    return { success: false, outputPath: "", error: msg };
  }
});
const MAX_FRAME_PX = 1280;
async function uploadFrameToPOYO(filePath, apiKey, index) {
  let b64;
  try {
    const img = nativeImage.createFromPath(filePath);
    if (!img.isEmpty()) {
      const { width, height } = img.getSize();
      const scale = Math.min(1, MAX_FRAME_PX / Math.max(width, height));
      const resized = scale < 1 ? img.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: "best" }) : img;
      b64 = resized.toJPEG(90).toString("base64");
    } else {
      b64 = readFileSync(filePath).toString("base64");
    }
  } catch {
    b64 = readFileSync(filePath).toString("base64");
  }
  const fileName = `frame_${index + 1}_${Date.now()}.jpg`;
  const res = await fetch("https://api.poyo.ai/api/common/upload/base64", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ base64_data: b64, file_name: fileName })
  });
  const data = await res.json();
  if (!data.success || !data.data?.file_url) throw new Error(data.error?.message ?? "Upload failed");
  return data.data.file_url;
}
async function uploadFilesToPOYO(filePaths, apiKey, sendProgress) {
  if (filePaths.length === 0) return [];
  sendProgress(`Uploading ${filePaths.length} image${filePaths.length > 1 ? "s" : ""} to POYO...`);
  const results = await Promise.allSettled(filePaths.map((f, i) => uploadFrameToPOYO(f, apiKey, i)));
  const failures = results.filter((r) => r.status === "rejected");
  if (failures.length > 0) {
    const err = failures[0].reason;
    throw new Error(`Upload failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  sendProgress(`${filePaths.length} image${filePaths.length > 1 ? "s" : ""} uploaded ✓`);
  return results.map((r) => r.value);
}
async function pollPOYOTask(taskId, apiKey, sendProgress) {
  await new Promise((r) => setTimeout(r, 8e3));
  let lastStatus = "";
  let lastPct = -1;
  const startTs = Date.now();
  for (let i = 0; i < 120; i++) {
    const res = await fetch(`https://api.poyo.ai/api/generate/status/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    const d = await res.json();
    const task = d.data;
    if (!task) {
      sendProgress(`Poll error: ${d.error?.message ?? "no data"}`);
      await new Promise((r) => setTimeout(r, 5e3));
      continue;
    }
    const pct = task.progress ?? 0;
    const elapsed = Math.round((Date.now() - startTs) / 1e3);
    if (task.status !== lastStatus || pct !== lastPct) {
      sendProgress(`${task.status}${pct > 0 ? ` ${pct}%` : ""} · ${elapsed}s`);
      lastStatus = task.status;
      lastPct = pct;
    }
    if (["finished", "completed", "succeeded"].includes(task.status)) return task.files ?? [];
    if (["failed", "error"].includes(task.status)) {
      throw new Error(task.error_message ? `POYO: ${task.error_message}` : `Generation ${task.status}`);
    }
    await new Promise((r) => setTimeout(r, 5e3));
  }
  throw new Error("Timeout — task exceeded 10 minutes");
}
const NB2_RATIOS = ["9:16", "4:5", "1:1", "16:9"];
const POYO_MAX_REFS = 14;
handleWhenUnlocked("upload-poyo-refs", async (event, { products }) => {
  if (!Array.isArray(products)) throw new Error("Invalid products");
  const apiKey = process.env.POYO_API_KEY;
  if (!apiKey) throw new Error("POYO_API_KEY not set — add it to ~/.bmp.env");
  const sendProgress = (line) => event.sender.send("higgsfield-progress", { scope: "image", line });
  let files = products;
  if (files.length > POYO_MAX_REFS) {
    sendProgress(`POYO accepts max ${POYO_MAX_REFS} reference images — using the first ${POYO_MAX_REFS}`);
    files = files.slice(0, POYO_MAX_REFS);
  }
  const urls = await uploadFilesToPOYO(files, apiKey, sendProgress);
  return { urls };
});
handleWhenUnlocked("fire-poyo-image", async (event, { prompt, products, aspectRatio, resolution, imageUrls: presetUrls }) => {
  if (typeof prompt !== "string" || prompt.trim().length === 0) throw new Error("Invalid prompt");
  if (!Array.isArray(products)) throw new Error("Invalid products");
  if (presetUrls !== void 0 && (!Array.isArray(presetUrls) || presetUrls.some((u) => typeof u !== "string"))) throw new Error("Invalid imageUrls");
  const apiKey = process.env.POYO_API_KEY;
  if (!apiKey) throw new Error("POYO_API_KEY not set — add it to ~/.bmp.env");
  const timestamp = Date.now();
  const desktopPath = loadPrefs().outputPath;
  const sendProgress = (line) => event.sender.send("higgsfield-progress", { scope: "image", line });
  const safeSize = NB2_RATIOS.includes(aspectRatio) ? aspectRatio : "4:5";
  const safeRes = ["1k", "2k", "4k"].includes(resolution) ? resolution.toUpperCase() : "2K";
  let imageUrls = (presetUrls ?? []).slice(0, POYO_MAX_REFS);
  if (imageUrls.length === 0 && products.length > 0) {
    let files = products;
    if (files.length > POYO_MAX_REFS) {
      sendProgress(`POYO accepts max ${POYO_MAX_REFS} reference images — using the first ${POYO_MAX_REFS}`);
      files = files.slice(0, POYO_MAX_REFS);
    }
    try {
      imageUrls = await uploadFilesToPOYO(files, apiKey, sendProgress);
    } catch (err) {
      sendProgress(err instanceof Error ? err.message : String(err));
      return { success: false, outputPath: "", error: String(err) };
    }
  }
  const model = imageUrls.length > 0 ? "nano-banana-2-edit" : "nano-banana-2";
  const input = { prompt, size: safeSize, resolution: safeRes };
  if (imageUrls.length > 0) input.image_urls = imageUrls;
  sendProgress(`Submitting Nano Banana 2 (${safeSize} · ${safeRes})...`);
  const submitRes = await fetch("https://api.poyo.ai/api/generate/submit", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input })
  });
  const submitData = await submitRes.json();
  if (!submitRes.ok || !submitData.data?.task_id) {
    const msg = submitData.error?.message ?? `HTTP ${submitRes.status}`;
    sendProgress(`Submit error: ${msg}`);
    return { success: false, outputPath: "", error: msg };
  }
  sendProgress(`Generating... (${submitData.data.task_id})`);
  try {
    const files = await pollPOYOTask(submitData.data.task_id, apiKey, sendProgress);
    const imgFile = files.find((f) => f.file_type === "image" || f.file_url.match(/\.(jpg|jpeg|png|webp)/i));
    if (!imgFile) {
      sendProgress("No image in response");
      return { success: false, outputPath: "", error: "No image file" };
    }
    const ext = imgFile.file_url.split(".").pop()?.split("?")[0] ?? "jpg";
    const outputName = `bmp_${timestamp}.${ext}`;
    const outputPath = join(desktopPath, outputName);
    sendProgress("Downloading image...");
    await downloadFile(imgFile.file_url, outputPath);
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
const RECRAFT_SIZES = {
  "9:16": "1536x2688",
  "4:5": "1792x2304",
  "1:1": "2048x2048",
  "16:9": "2688x1536"
};
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
function sniffImageExt(path) {
  const head = readFileSync(path).subarray(0, 4);
  return head.toString("latin1") === "RIFF" ? "webp" : head[0] === 137 && head[1] === 80 ? "png" : head[0] === 255 && head[1] === 216 ? "jpg" : "png";
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
async function recraftGenerateToFile(prompt, aspectRatio, destDir, baseName, sendProgress) {
  const apiKey = process.env.RECRAFT_API_KEY;
  if (!apiKey) throw new Error("RECRAFT_API_KEY not set — add it to ~/.bmp.env");
  const size = RECRAFT_SIZES[aspectRatio] ?? RECRAFT_SIZES["4:5"];
  sendProgress(`Submitting Recraft v4.1 Pro (${aspectRatio} · ${size})...`);
  const res = await fetch("https://external.api.recraft.ai/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    // No `style` param — Recraft v4.1 Pro rejects it ("doesn't support style
    // 'realistic_image'"); the model's default is already photorealistic
    body: JSON.stringify({ prompt, model: "recraftv4_1_pro", n: 1, size, response_format: "url" })
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const errBody = await res.json();
      msg = errBody.error?.message ?? errBody.message ?? msg;
    } catch {
    }
    throw new Error(msg);
  }
  const data = await res.json();
  const imageUrl = data.data?.[0]?.url;
  if (!imageUrl) throw new Error("No image URL in Recraft response");
  sendProgress("Downloading image...");
  const tmpPath = join(destDir, `${baseName}.download`);
  await downloadFile(imageUrl, tmpPath);
  const outputPath = join(destDir, `${baseName}.${sniffImageExt(tmpPath)}`);
  renameSync(tmpPath, outputPath);
  knownLocalPaths.add(outputPath);
  await sendSavedLine(outputPath, sendProgress);
  return outputPath;
}
async function poyoGenerateToFile(opts) {
  const { model, input, apiKey, destDir, baseName, sendProgress } = opts;
  const submitRes = await fetch("https://api.poyo.ai/api/generate/submit", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input })
  });
  const submitData = await submitRes.json();
  if (!submitRes.ok || !submitData.data?.task_id) {
    throw new Error(submitData.error?.message ?? `HTTP ${submitRes.status}`);
  }
  sendProgress(`Generating... (${submitData.data.task_id})`);
  const files = await pollPOYOTask(submitData.data.task_id, apiKey, sendProgress);
  const imgFile = files.find((f) => f.file_type === "image" || f.file_url.match(/\.(jpg|jpeg|png|webp)/i));
  if (!imgFile) throw new Error("No image file in response");
  const urlExt = imgFile.file_url.split(".").pop()?.split("?")[0]?.toLowerCase();
  const ext = urlExt && urlExt.length <= 4 ? urlExt : "jpg";
  const outputPath = join(destDir, `${baseName}.${ext}`);
  sendProgress("Downloading image...");
  await downloadFile(imgFile.file_url, outputPath);
  knownLocalPaths.add(outputPath);
  await sendSavedLine(outputPath, sendProgress);
  return outputPath;
}
async function uploadRefToPOYO(path, apiKey) {
  if (!path.toLowerCase().endsWith(".webp")) return uploadFrameToPOYO(path, apiKey, 0);
  const tmp = path.replace(/\.webp$/i, "_ref.jpg");
  await execFileAsync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "90", path, "--out", tmp]);
  try {
    return await uploadFrameToPOYO(tmp, apiKey, 0);
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
    }
  }
}
handleWhenUnlocked("fire-model", async (event, { prompt, engine, aspectRatio, resolution, gender }) => {
  if (typeof prompt !== "string" || prompt.trim().length === 0 || prompt.length > 1e4) throw new Error("Invalid prompt");
  const sendProgress = (line) => event.sender.send("higgsfield-progress", { scope: "model", line });
  const safeGender = gender === "male" ? "male" : "female";
  const safeEngine = engine === "recraft" ? "recraft" : "nb2";
  const safeSize = NB2_RATIOS.includes(aspectRatio) ? aspectRatio : "4:5";
  const safeRes = ["1k", "2k", "4k"].includes(resolution) ? resolution.toUpperCase() : "2K";
  const poyoKey = process.env.POYO_API_KEY;
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
        fullPath = await recraftGenerateToFile(prompt, safeSize, dir, sku, sendProgress);
      } else {
        if (!poyoKey) throw new Error("POYO_API_KEY not set — add it to ~/.bmp.env");
        sendProgress(`Submitting Nano Banana 2 (${safeSize} · ${safeRes})...`);
        fullPath = await poyoGenerateToFile({
          model: "nano-banana-2",
          input: { prompt, size: safeSize, resolution: safeRes },
          apiKey: poyoKey,
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
    if (!poyoKey) {
      faceError = "POYO_API_KEY not set — face macro skipped";
      sendProgress(faceError);
    } else {
      try {
        sendProgress("▶ Macro face shot — uploading reference...");
        const refUrl = await uploadRefToPOYO(fullPath, poyoKey);
        facePath = await poyoGenerateToFile({
          model: "nano-banana-2-edit",
          input: { prompt: MACRO_FACE_PROMPT, size: "4:5", resolution: "2K", image_urls: [refUrl] },
          apiKey: poyoKey,
          destDir: dir,
          baseName: `${sku}_FACE`,
          sendProgress
        });
      } catch (err) {
        faceError = err instanceof Error ? err.message : String(err);
        sendProgress(`Face macro failed — ${faceError}`);
      }
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
  const apiKey = process.env.POYO_API_KEY;
  if (!apiKey) throw new Error("POYO_API_KEY not set — add it to ~/.bmp.env");
  const timestamp = Date.now();
  const desktopPath = loadPrefs().outputPath;
  const sendProgress = (line) => event.sender.send("higgsfield-progress", { scope: "video", line });
  const tagRefs = [...prompt.matchAll(/@Image(\d+)/gi)].map((m) => parseInt(m[1]));
  const maxTag = tagRefs.length > 0 ? Math.max(...tagRefs) : 0;
  if (maxTag > frames.length) {
    sendProgress(`Warning: prompt references @Image${maxTag} but only ${frames.length} frame${frames.length !== 1 ? "s" : ""} provided`);
  }
  let referenceImageUrls = [];
  if (frames.length > 0) {
    try {
      referenceImageUrls = await uploadFilesToPOYO(frames, apiKey, sendProgress);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendProgress(msg);
      return { success: false, outputPath: "", error: msg };
    }
  }
  const input = {
    prompt,
    resolution,
    duration,
    generate_audio: false
  };
  if (aspectRatio !== "auto") input.aspect_ratio = aspectRatio;
  if (referenceImageUrls.length > 0) input.reference_image_urls = referenceImageUrls;
  sendProgress(`Submitting to Seedance 2 (${aspectRatio} · ${resolution} · ${duration}s)...`);
  const submitRes = await fetch("https://api.poyo.ai/api/generate/submit", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: videoModel, input })
  });
  const submitData = await submitRes.json();
  if (!submitRes.ok || !submitData.data?.task_id) {
    const msg = submitData.error?.message ?? `HTTP ${submitRes.status}`;
    sendProgress(`Submit error: ${msg}`);
    return { success: false, outputPath: "", error: msg };
  }
  const taskId = submitData.data.task_id;
  sendProgress(`Generating... (task: ${taskId})`);
  try {
    const files = await pollPOYOTask(taskId, apiKey, sendProgress);
    const videoFile = files.find((f) => f.file_type === "video" || f.file_url.match(/\.mp4|\.mov/i));
    if (!videoFile) {
      sendProgress("No video file in response");
      return { success: false, outputPath: "", error: "No video file" };
    }
    const outputName = `bmp_video_${timestamp}.mp4`;
    const outputPath = join(desktopPath, outputName);
    sendProgress("Downloading video...");
    await downloadFile(videoFile.file_url, outputPath);
    sendProgress(`Saved: ${outputName}`);
    return { success: true, outputPath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendProgress(`Error: ${msg}`);
    return { success: false, outputPath: "", error: msg };
  }
});
function createWindow() {
  const win = new BrowserWindow({
    width: 920,
    height: 720,
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
      zoomFactor: 1.1
    }
  });
  win.webContents.on("did-finish-load", () => {
    win.webContents.setZoomFactor(1.1);
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
