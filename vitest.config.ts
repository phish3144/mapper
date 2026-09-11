import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    /**
     * Platzhalter fuer die Supabase-Zugaenge.
     *
     * src/lib/supabase.ts wirft beim Laden des Moduls, wenn die beiden Werte
     * fehlen - zu Recht, eine Anwendung ohne Backend ist kaputt. Nur zieht
     * jeder Test, der irgendwo db.ts beruehrt, dieses Modul mit herein, und
     * dann braeuchte er Zugangsdaten fuer etwas, das er gar nicht aufruft.
     *
     * Lokal fiel das nie auf, weil eine .env danebenliegt. In der
     * Veroeffentlichung gab es die nicht, und db.test.ts liess jeden Lauf
     * scheitern - der Fehler stand im Testschritt, nicht im Bau.
     *
     * Bewusst erfundene Werte und nicht die echten: kein Test soll je gegen
     * ein echtes Backend laufen koennen, auch nicht versehentlich.
     */
    env: {
      VITE_SUPABASE_URL: 'http://supabase.test',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_nur_fuer_tests',
    },
  },
})
