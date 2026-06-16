import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
// Self-hosted fonts (offline-safe) — Inter for UI, JetBrains Mono for tabular
// numbers. Matches the prototype's type system; variable files cover all weights.
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './contexts/AuthContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
