/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string
  readonly VITE_OSRM_BASE_URL?: string
  readonly VITE_ORS_API_KEY?: string
  readonly VITE_NOMINATIM_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
