import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import './styles/global.css'
import './styles/layout.css'
import App from './App'
import { useUi, applyTheme } from './lib/uiStore'

applyTheme(useUi.getState().theme)

const root = document.getElementById('root')
if (!root) throw new Error('Wurzelelement #root fehlt.')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
