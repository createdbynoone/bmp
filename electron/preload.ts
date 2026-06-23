import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('bmp', {
  generatePrompt: (data: { refs: string[]; products: string[]; description: string }) =>
    ipcRenderer.invoke('generate-prompt', data),

  fireHighsfield: (data: { prompt: string; aspectRatio: string; products: string[]; resolution: string }) =>
    ipcRenderer.invoke('fire-higgsfield', data),

  getHiggsfieldCredits: () =>
    ipcRenderer.invoke('get-higgsfield-credits'),

  markPromptFired: (data: { id: string; aspectRatio: string }) =>
    ipcRenderer.invoke('mark-prompt-fired', data),

  getMemoryStats: () =>
    ipcRenderer.invoke('get-memory-stats'),

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
})
