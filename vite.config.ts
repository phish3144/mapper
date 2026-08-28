import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  // Bei GitHub Pages liegt die Anwendung unter /<repo>/, nicht im Wurzelpfad.
  // Ohne den passenden Basispfad zeigen alle Asset-Verweise ins Leere.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        // Karte und Datenbankclient aendern sich selten, der eigene Code oft.
        // Getrennte Buendel halten den Zwischenspeicher der Besucher warm.
        manualChunks: {
          leaflet: ['leaflet', 'react-leaflet', 'leaflet.markercluster'],
          supabase: ['@supabase/supabase-js'],
          react: ['react', 'react-dom'],
          dnd: ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/modifiers', '@dnd-kit/utilities'],
        },
      },
    },
  },
})
