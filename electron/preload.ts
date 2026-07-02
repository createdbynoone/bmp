import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('bmp', {
  // Electron 32+ removed File.path from the renderer — this resolves the
  // absolute path of files dragged in from Finder
  getPathForFile: (file: File) => webUtils.getPathForFile(file),

  generatePrompt: (data: { refs: string[]; products: string[]; description: string }) =>
    ipcRenderer.invoke('generate-prompt', data),

  fireHighsfield: (data: { prompt: string; aspectRatio: string; products: string[]; resolution: string; provider?: string }) =>
    ipcRenderer.invoke('fire-higgsfield', data),

  fireVideo: (data: { prompt: string; products: string[]; videoModel: string; aspectRatio: string; resolution: string; duration: number; generateAudio: boolean }) =>
    ipcRenderer.invoke('fire-video', data),

  firePoyoImage: (data: { prompt: string; products: string[]; aspectRatio: string; resolution: string }) =>
    ipcRenderer.invoke('fire-poyo-image', data),

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

  onHiggsfieldProgress: (cb: (line: string) => void) => {
    ipcRenderer.on('higgsfield-progress', (_event, line) => cb(line))
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
