import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    build: {
      lib: {
        entry: resolve('electron/main.ts'),
      },
    },
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    build: {
      rollupOptions: {
        input: resolve('electron/preload.ts'),
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    root: 'src',
    server: {
      port: 5274,
    },
    build: {
      rollupOptions: {
        input: resolve('src/index.html'),
      },
    },
    plugins: [react()],
  },
})
