import { ipcMain, app, dialog, protocol, net, BrowserWindow, nativeImage, Menu, shell } from "electron";
import { join } from "path";
import { writeFileSync, readFileSync, createWriteStream } from "fs";
import { homedir } from "os";
import { execFile, exec } from "child_process";
import { promisify } from "util";
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
function getIconPath(styleName) {
  const filename = `Icon-macOS-${styleName}-1024@1x.png`;
  if (app.isPackaged) return join(process.resourcesPath, "icons", filename);
  return join(__dirname, "../../build/icons", filename);
}
function applyDockIcon(styleName) {
  if (process.platform !== "darwin") return;
  try {
    const icon = nativeImage.createFromPath(getIconPath(styleName));
    if (!icon.isEmpty()) app.dock.setIcon(icon);
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
ipcMain.handle("generate-prompt", async (_event, { refs, products, description }) => {
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
    model: "claude-sonnet-4-6",
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
ipcMain.handle("mark-prompt-fired", (_event, { id, aspectRatio }) => {
  markFired(id, aspectRatio);
});
ipcMain.handle("get-version", () => app.getVersion());
ipcMain.handle("get-output-path", () => loadPrefs().outputPath);
ipcMain.handle("set-output-path", (_event, path) => {
  if (typeof path !== "string" || path.length === 0) throw new Error("Invalid path");
  savePrefs({ ...loadPrefs(), outputPath: path });
});
ipcMain.handle("open-folder-dialog", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
    title: "Choose output folder"
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});
ipcMain.handle("get-memory-stats", () => {
  const memory = loadMemory();
  return {
    total: memory.entries.length,
    fired: memory.entries.filter((e) => e.fired).length
  };
});
ipcMain.handle("get-memory-entries", () => {
  const memory = loadMemory();
  return [...memory.entries].reverse();
});
ipcMain.handle("check-higgsfield-auth", async () => {
  return { authenticated: !!process.env.GEMINI_API_KEY };
});
ipcMain.handle("higgsfield-login", async () => {
  return { ok: false, error: "Add GEMINI_API_KEY to ~/.bmp.env" };
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
ipcMain.handle("get-higgsfield-credits", async () => {
  return { credits: null, plan: "imagen-3" };
});
const GEMINI_IMAGE_MODEL = "gemini-3-pro-image";
const HF_VALID_RESOLUTIONS = ["1k", "2k"];
const HF_VALID_ASPECT_RATIOS = ["9:16", "4:5", "1:1", "16:9", "1:2", "2:1"];
ipcMain.handle("fire-higgsfield", async (event, { prompt, aspectRatio, products, resolution, provider }) => {
  if (typeof prompt !== "string" || prompt.trim().length === 0 || prompt.length > 12e3) {
    throw new Error("Invalid prompt");
  }
  if (!Array.isArray(products) || products.length > 30) throw new Error("Invalid products");
  const sendProgress = (line) => event.sender.send("higgsfield-progress", line);
  const timestamp = Date.now();
  const desktopPath = loadPrefs().outputPath;
  if (provider === "higgsfield") {
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
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set — add it to ~/.bmp.env");
  const productParts = [];
  if (products.length > 0) {
    sendProgress(`Encoding ${products.length} product image${products.length > 1 ? "s" : ""} as reference...`);
    for (const p of products) {
      const encoded = resizeAndEncode(p);
      if (encoded) productParts.push({ inlineData: { mimeType: encoded.mediaType, data: encoded.b64 } });
    }
  }
  const textInstruction = productParts.length > 0 ? `The image${productParts.length > 1 ? "s" : ""} above show the Brotherhood garment. You MUST preserve the exact garment: same color, graphics, logos, and construction details. Generate the editorial fashion photo:

${prompt}` : prompt;
  const requestParts = [...productParts, { text: textInstruction }];
  const imageConfig = {};
  if (aspectRatio) imageConfig.aspectRatio = aspectRatio;
  if (resolution) imageConfig.imageSize = resolution;
  sendProgress(`Starting Gemini (${aspectRatio ?? ""}${resolution ? " · " + resolution.toUpperCase() : ""})...`);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: requestParts }],
          generationConfig: { responseModalities: ["IMAGE"], imageConfig }
        })
      }
    );
    const data = await res.json();
    if (!res.ok) {
      const msg = data.error?.message ?? `HTTP ${res.status}`;
      sendProgress(`API error: ${msg}`);
      return { success: false, outputPath: "", error: msg };
    }
    const responseParts = data.candidates?.[0]?.content?.parts ?? [];
    const imagePart = responseParts.find((p) => p.inlineData);
    if (!imagePart?.inlineData) {
      const textPart = responseParts.find((p) => p.text);
      const hint = textPart?.text?.slice(0, 150) ?? "No image in response — possible content policy rejection";
      sendProgress(hint);
      return { success: false, outputPath: "", error: hint };
    }
    const { mimeType, data: b64 } = imagePart.inlineData;
    const ext = mimeType === "image/png" ? "png" : "jpg";
    const outputName = `bmp_${timestamp}.${ext}`;
    const outputPath = join(desktopPath, outputName);
    writeFileSync(outputPath, Buffer.from(b64, "base64"));
    try {
      const { stdout } = await execFileAsync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", outputPath]);
      const w = stdout.match(/pixelWidth:\s*(\d+)/)?.[1];
      const h = stdout.match(/pixelHeight:\s*(\d+)/)?.[1];
      if (w && h) sendProgress(`Saved: ${outputName} · ${w}×${h}px`);
      else sendProgress(`Saved: ${outputName}`);
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
    if (["failed", "error"].includes(task.status)) throw new Error(`Generation ${task.status}`);
    await new Promise((r) => setTimeout(r, 5e3));
  }
  throw new Error("Timeout — task exceeded 10 minutes");
}
const NB2_RATIOS = ["9:16", "4:5", "3:4", "1:1", "16:9"];
ipcMain.handle("fire-poyo-image", async (event, { prompt, products, aspectRatio, resolution }) => {
  if (typeof prompt !== "string" || prompt.trim().length === 0) throw new Error("Invalid prompt");
  if (!Array.isArray(products) || products.length > 14) throw new Error("Invalid products");
  const apiKey = process.env.POYO_API_KEY;
  if (!apiKey) throw new Error("POYO_API_KEY not set — add it to ~/.bmp.env");
  const timestamp = Date.now();
  const desktopPath = loadPrefs().outputPath;
  const sendProgress = (line) => event.sender.send("higgsfield-progress", line);
  const safeSize = NB2_RATIOS.includes(aspectRatio) ? aspectRatio : "3:4";
  const safeRes = ["1k", "2k", "4k"].includes(resolution) ? resolution.toUpperCase() : "2K";
  let imageUrls = [];
  try {
    imageUrls = await uploadFilesToPOYO(products, apiKey, sendProgress);
  } catch (err) {
    sendProgress(err instanceof Error ? err.message : String(err));
    return { success: false, outputPath: "", error: String(err) };
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
ipcMain.handle("fire-video", async (event, { prompt, products: frames, videoModel, aspectRatio, resolution, duration, generateAudio }) => {
  if (typeof prompt !== "string" || prompt.trim().length === 0) throw new Error("Invalid prompt");
  if (!Array.isArray(frames) || frames.length > 9) throw new Error("Invalid frames");
  const apiKey = process.env.POYO_API_KEY;
  if (!apiKey) throw new Error("POYO_API_KEY not set — add it to ~/.bmp.env");
  const timestamp = Date.now();
  const desktopPath = loadPrefs().outputPath;
  const sendProgress = (line) => event.sender.send("higgsfield-progress", line);
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
    generate_audio: generateAudio
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
    return net.fetch(`file://${filePath}`);
  });
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
