interface Window {
  bmp: {
    generatePrompt: (data: { refs: string[]; products: string[]; description: string }) => Promise<string>
    fireHighsfield: (data: { prompt: string }) => Promise<{ success: boolean; outputPath: string }>
    onHiggsfieldProgress: (cb: (line: string) => void) => () => void
  }
}
