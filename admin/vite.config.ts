import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === "production" ? "/admin/" : "/",
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: process.env.VITE_GAME_URL || 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
      '/admin': {
        target: process.env.VITE_WORKERS_URL || 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
}))
