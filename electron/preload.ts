import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('bmp', {
  auth: {
    status: () => ipcRenderer.invoke('auth:status'),
    unlock: (key: string) => ipcRenderer.invoke('auth:unlock', key),
  },

  // Electron 32+ removed File.path from the renderer — this resolves the
  // absolute path of files dragged in from Finder. Also registers the path
  // with the main process so the localfile:// protocol is allowed to serve it.
  getPathForFile: (file: File) => {
    const path = webUtils.getPathForFile(file)
    ipcRenderer.sendSync('register-known-path', path)
    return path
  },

  generatePrompt: (data: { refs: string[]; products: string[]; description: string }) =>
    ipcRenderer.invoke('generate-prompt', data),

  fireVideo: (data: { prompt: string; products: string[]; videoModel: string; aspectRatio: string; resolution: string; duration: number }) =>
    ipcRenderer.invoke('fire-video', data),

  firePoyoImage: (data: { prompt: string; products: string[]; aspectRatio: string; resolution: string; provider: 'seedream' | 'nanobanana'; imageUrls?: string[] }) =>
    ipcRenderer.invoke('fire-poyo-image', data),

  fireModel: (data: { prompt: string; engine: 'nb2' | 'recraft'; aspectRatio: string; resolution: string; gender: 'female' | 'male' }) =>
    ipcRenderer.invoke('fire-model', data),

  uploadPoyoRefs: (data: { products: string[] }) =>
    ipcRenderer.invoke('upload-poyo-refs', data),

  getHiggsfieldCredits: () =>
    ipcRenderer.invoke('get-higgsfield-credits'),

  markPromptFired: (data: { id: string; aspectRatio: string }) =>
    ipcRenderer.invoke('mark-prompt-fired', data),

  getMemoryStats: () =>
    ipcRenderer.invoke('get-memory-stats'),

  getMemoryEntries: () =>
    ipcRenderer.invoke('get-memory-entries'),

  checkHiggsfieldAuth: () =>
    ipcRenderer.invoke('check-higgsfield-auth'),

  higgsfieldLogin: () =>
    ipcRenderer.invoke('higgsfield-login'),

  onHiggsfieldProgress: (cb: (evt: { scope: 'image' | 'video' | 'model'; line: string }) => void) => {
    ipcRenderer.on('higgsfield-progress', (_event, evt) => cb(evt))
    return () => ipcRenderer.removeAllListeners('higgsfield-progress')
  },

  onUpdateStatus: (cb: (status: { phase: string; version?: string; percent?: number; error?: string }) => void) => {
    ipcRenderer.on('update-status', (_event, status) => cb(status))
    return () => ipcRenderer.removeAllListeners('update-status')
  },

  getVersion: () => ipcRenderer.invoke('get-version'),

  getOutputPath: () => ipcRenderer.invoke('get-output-path'),
  setOutputPath: (path: string) => ipcRenderer.invoke('set-output-path', path),
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog') as Promise<string | null>,
})
