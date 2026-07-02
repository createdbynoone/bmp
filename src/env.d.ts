interface Window {
  bmp: {
    getPathForFile: (file: File) => string
    generatePrompt: (data: { refs: string[]; products: string[]; description: string }) => Promise<{ prompt: string; memoryId: string }>
    fireHighsfield: (data: { prompt: string; aspectRatio: string; products: string[]; resolution: string; provider?: string }) => Promise<{ success: boolean; outputPath: string }>
    fireVideo: (data: { prompt: string; products: string[]; videoModel: string; aspectRatio: string; resolution: string; duration: number; generateAudio: boolean }) => Promise<{ success: boolean; outputPath: string }>
    firePoyoImage: (data: { prompt: string; products: string[]; aspectRatio: string; resolution: string }) => Promise<{ success: boolean; outputPath: string }>
    getHiggsfieldCredits: () => Promise<{ credits: number | null; plan: string | null }>
    markPromptFired: (data: { id: string; aspectRatio: string }) => Promise<void>
    getMemoryStats: () => Promise<{ total: number; fired: number }>
    getMemoryEntries: () => Promise<Array<{ id: string; timestamp: number; description: string; prompt: string; fired: boolean; aspectRatio?: string }>>
    checkHiggsfieldAuth: () => Promise<{ authenticated: boolean }>
    higgsfieldLogin: () => Promise<{ ok: boolean; error?: string }>
    onHiggsfieldProgress: (cb: (line: string) => void) => () => void
    onUpdateStatus: (cb: (status: { phase: 'available' | 'downloading' | 'installing' | 'ready' | 'error'; version?: string; percent?: number; error?: string }) => void) => () => void
    getVersion: () => Promise<string>
    getOutputPath: () => Promise<string>
    setOutputPath: (path: string) => Promise<void>
    openFolderDialog: () => Promise<string | null>
  }
}
