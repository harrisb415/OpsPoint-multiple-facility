import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Auto-detect whether the backend is using TLS by checking for the cert file
// Default to https since TLS certs exist in data/
const BACKEND = 'https://localhost:3000'

function withOriginRewrite(target) {
  return {
    target,
    changeOrigin: true,
    secure: false, // allow self-signed TLS cert on local backend
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyReq) => {
        proxyReq.setHeader('origin', target)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': withOriginRewrite(BACKEND),
      '/login': withOriginRewrite(BACKEND),
      '/logout': withOriginRewrite(BACKEND),
      '/change-password': withOriginRewrite(BACKEND),
      '/photos': { target: BACKEND, changeOrigin: true, secure: false },
      '/static': { target: BACKEND, changeOrigin: true, secure: false },
      '/cert': { target: BACKEND, changeOrigin: true, secure: false },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1000,
  },
})
