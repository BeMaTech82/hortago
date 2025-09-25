import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp}']
      },
      manifest: {
        name: 'Mon App PWA',
        short_name: 'MonApp',
        description: 'Une PWA rapide avec Vanilla JS',
        theme_color: '#2563eb',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'la-generation-didees.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'la-generation-didees.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ],
  // Configuration pour éviter eval() en développement
  build: {
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true
      }
    },
    rollupOptions: {
      output: {
        manualChunks: undefined
      }
    }
  },
  // Désactiver eval en développement
  define: {
    __DEV__: JSON.stringify(process.env.NODE_ENV !== 'production')
  },
  esbuild: {
    drop: ['console', 'debugger']
  }
})