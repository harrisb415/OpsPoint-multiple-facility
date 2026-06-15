import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import flowbiteReact from 'flowbite-react/plugin/vite'

// Central HQ server (server.js) listens on :4000 over http in dev.
const BACKEND = 'http://localhost:4000'

const proxy = (path) => ({ [path]: { target: BACKEND, changeOrigin: true, secure: false } })

export default defineConfig({
  plugins: [react(), tailwindcss(), flowbiteReact()],
  server: {
    port: 5174,
    proxy: {
      ...proxy('/api'),
      ...proxy('/login'),
      ...proxy('/logout'),
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1000,
  },
})
