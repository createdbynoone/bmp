import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('bmp', {
  generatePrompt: (data: { refs: string[]; products: string[]; description: string }) =>
    ipcRenderer.invoke('generate-prompt', data),

  fireHighsfield: (data: { prompt: string }) =>
    ipcRenderer.invoke('fire-higgsfield', data),

  onHiggsfieldProgress: (cb: (line: string) => void) => {
    ipcRenderer.on('higgsfield-progress', (_event, line) => cb(line))
    return () => ipcRenderer.removeAllListeners('higgsfield-progress')
  },
})
