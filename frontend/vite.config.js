import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Backend: backend/config/puma.rb — PORT по умолчанию 3001
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiProxy =
    (env.VITE_DEV_API_PROXY || 'http://127.0.0.1:3001').replace(/\/$/, '')

  return {
    server: {
      host: true,
      proxy: {
        '/api': { target: apiProxy, changeOrigin: true },
      },
    },
    plugins: [react(), tailwindcss()],
  }
})