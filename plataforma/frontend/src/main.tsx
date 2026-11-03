import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './index.css'
import { Shell } from './components/Shell'
import { startLive } from './lib/live'
import Inicio from './pages/Inicio'

const Preparar = lazy(() => import('./pages/Preparar'))
const Evaluar = lazy(() => import('./pages/Evaluar'))
const Resultado = lazy(() => import('./pages/Resultado'))
const Progreso = lazy(() => import('./pages/Progreso'))
const Pro = lazy(() => import('./pages/Pro'))
const Banco = lazy(() => import('./pages/Banco'))

const wrap = (el: React.ReactNode) => <Suspense fallback={<div className="p-10 text-muted">Cargando…</div>}>{el}</Suspense>

const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: '/', element: <Inicio /> },
      { path: '/preparar', element: wrap(<Preparar />) },
      { path: '/evaluar', element: wrap(<Evaluar />) },
      { path: '/salto/:id', element: wrap(<Resultado />) },
      { path: '/progreso', element: wrap(<Progreso />) },
      { path: '/pro', element: wrap(<Pro />) },
      { path: '/banco', element: wrap(<Banco />) },
    ],
  },
])

startLive()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
