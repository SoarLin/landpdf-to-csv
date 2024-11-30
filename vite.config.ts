import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import pdf from 'vite-plugin-pdf'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    pdf({
      pages: []
    }),
    vueDevTools(),
  ],
  optimizeDeps: {
    include: ['pdfjs-dist/build/pdf.worker.js']
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('pdfjs-dist')) {
            return 'pdfjs-dist'
          }
        }
      }
    }
  }
})
