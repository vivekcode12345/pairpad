import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './monacoSetup'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/navbar.css'
import './styles/sections.css'
import './styles/mobile.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
