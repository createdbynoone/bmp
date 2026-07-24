"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("bmp", {
  auth: {
    status: () => electron.ipcRenderer.invoke("auth:status"),
    unlock: (key) => electron.ipcRenderer.invoke("auth:unlock", key)
  },
  // Electron 32+ removed File.path from the renderer — this resolves the
  // absolute path of files dragged in from Finder. Also registers the path
  // with the main process so the localfile:// protocol is allowed to serve it.
  getPathForFile: (file) => {
    const path = electron.webUtils.getPathForFile(file);
    electron.ipcRenderer.sendSync("register-known-path", path);
    return path;
  },
  generatePrompt: (data) => electron.ipcRenderer.invoke("generate-prompt", data),
  fireVideo: (data) => electron.ipcRenderer.invoke("fire-video", data),
  firePoyoImage: (data) => electron.ipcRenderer.invoke("fire-poyo-image", data),
  fireModel: (data) => electron.ipcRenderer.invoke("fire-model", data),
  uploadPoyoRefs: (data) => electron.ipcRenderer.invoke("upload-poyo-refs", data),
  getHiggsfieldCredits: () => electron.ipcRenderer.invoke("get-higgsfield-credits"),
  markPromptFired: (data) => electron.ipcRenderer.invoke("mark-prompt-fired", data),
  getMemoryStats: () => electron.ipcRenderer.invoke("get-memory-stats"),
  getMemoryEntries: () => electron.ipcRenderer.invoke("get-memory-entries"),
  checkHiggsfieldAuth: () => electron.ipcRenderer.invoke("check-higgsfield-auth"),
  higgsfieldLogin: () => electron.ipcRenderer.invoke("higgsfield-login"),
  onHiggsfieldProgress: (cb) => {
    electron.ipcRenderer.on("higgsfield-progress", (_event, evt) => cb(evt));
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
