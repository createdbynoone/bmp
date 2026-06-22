interface Window {
  bmp: {
    generatePrompt: (data: { refs: string[]; products: string[]; description: string }) => Promise<{ prompt: string; memoryId: string }>
    fireHighsfield: (data: { prompt: string; aspectRatio: string; products: string[] }) => Promise<{ success: boolean; outputPath: string }>
    markPromptFired: (data: { id: string; aspectRatio: string }) => Promise<void>
    getMemoryStats: () => Promise<{ total: number; fired: number }>
    checkHiggsfieldAuth: () => Promise<{ authenticated: boolean }>
    higgsfieldLogin: () => Promise<{ ok: boolean; error?: string }>
    onHiggsfieldProgress: (cb: (line: string) => void) => () => void
    onUpdateStatus: (cb: (status: { phase: string; version?: string; percent?: number; error?: string }) => void) => () => void
  }
}
