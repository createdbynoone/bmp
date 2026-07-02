"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("bmp", {
  // Electron 32+ removed File.path from the renderer — this resolves the
  // absolute path of files dragged in from Finder
  getPathForFile: (file) => electron.webUtils.getPathForFile(file),
  generatePrompt: (data) => electron.ipcRenderer.invoke("generate-prompt", data),
  fireHighsfield: (data) => electron.ipcRenderer.invoke("fire-higgsfield", data),
  fireVideo: (data) => electron.ipcRenderer.invoke("fire-video", data),
  firePoyoImage: (data) => electron.ipcRenderer.invoke("fire-poyo-image", data),
  getHiggsfieldCredits: () => electron.ipcRenderer.invoke("get-higgsfield-credits"),
  markPromptFired: (data) => electron.ipcRenderer.invoke("mark-prompt-fired", data),
  getMemoryStats: () => electron.ipcRenderer.invoke("get-memory-stats"),
  getMemoryEntries: () => electron.ipcRenderer.invoke("get-memory-entries"),
  checkHiggsfieldAuth: () => electron.ipcRenderer.invoke("check-higgsfield-auth"),
  higgsfieldLogin: () => electron.ipcRenderer.invoke("higgsfield-login"),
  onHiggsfieldProgress: (cb) => {
    electron.ipcRenderer.on("higgsfield-progress", (_event, line) => cb(line));
    return () => electron.ipcRenderer.removeAllListeners("higgsfield-progress");
  },
  onUpdateStatus: (cb) => {
    electron.ipcRenderer.on("update-status", (_event, status) => cb(status));
    return () => electron.ipcRenderer.removeAllListeners("update-status");
  },
  getVersion: () => electron.ipcRenderer.invoke("get-version"),
  getOutputPath: () => electron.ipcRenderer.invoke("get-output-path"),
  setOutputPath: (path) => electron.ipcRenderer.invoke("set-output-path", path),
  openFolderDialog: () => electron.ipcRenderer.invoke("open-folder-dialog")
});
