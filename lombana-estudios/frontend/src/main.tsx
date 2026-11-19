import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, MemoryRouter } from 'react-router-dom'
import './index.css'
import App from './App'
import { ToastProvider } from './components/ui'
import { IS_ARTIFACT } from './lib/api'

const root = createRoot(document.getElementById('root')!)
const render = (banner?: string) => {
  const Router = IS_ARTIFACT ? MemoryRouter : BrowserRouter
  root.render(
    <StrictMode>
      <Router>
        {banner && <div role="alert" className="bg-red-900/80 px-4 py-2 text-center text-sm text-red-100">{banner}</div>}
        <ToastProvider><App /></ToastProvider>
      </Router>
    </StrictMode>,
  )
}

if (IS_ARTIFACT) {
  root.render(<div className="grid h-full place-items-center text-slate-400">Cargando LOMBANA ESTUDIOS…</div>)
  import('./local/boot').then(m => m.boot()).then(render).catch(e => render(`No se pudo iniciar: ${e?.message ?? e}`))
} else {
  render()
}
