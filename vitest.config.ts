import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Kept separate from vite.config.ts so tests do not load the Figma Make dev-server plugins.
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
    testTimeout: 15_000,
    execArgv: ['--disable-warning=ExperimentalWarning'],
  },
})
