import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{ts,tsx}', './index.html'],
  theme: {
    extend: {
      colors: {
        bg: '#0c0c0c',
        surface: '#141414',
        border: '#242424',
        accent: '#E8B547',
        'text-primary': '#F0EBE0',
        'text-secondary': '#9A9A9A',
        'text-muted': '#666666',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        heading: ['Space Grotesk', 'Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
}

export default config
