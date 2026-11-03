/**
 * WebSocket /ws/live. Los cuadros de pose (30 Hz) NO pasan por React: se guardan
 * en un objeto mutable que la escena 3D lee en cada fotograma. El estado y los
 * saltos sí van al store (cambian pocas veces por segundo).
 */
import { useLive } from './store'
import type { LiveFrame, SaltoEvento, Status } from './types'

export const frame: { current: LiveFrame | null; recibido: number } = { current: null, recibido: 0 }

type Listener<T> = (x: T) => void
const contactListeners = new Set<Listener<{ t: number; vuelo_ms: number }>>()
const jumpListeners = new Set<Listener<SaltoEvento>>()

export const onContacto = (f: Listener<{ t: number; vuelo_ms: number }>) => {
  contactListeners.add(f)
  return () => void contactListeners.delete(f)
}
export const onSalto = (f: Listener<SaltoEvento>) => {
  jumpListeners.add(f)
  return () => void jumpListeners.delete(f)
}

let ws: WebSocket | null = null
let retry = 0
let started = false

function open() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  ws = new WebSocket(`${proto}://${location.host}/ws/live`)
  ws.onopen = () => {
    retry = 0
    useLive.getState().set({ conectadoWs: true })
  }
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    switch (msg.type) {
      case 'live':
        frame.current = msg as LiveFrame
        frame.recibido = performance.now()
        break
      case 'status':
        useLive.getState().set({ status: msg as Status })
        break
      case 'contacto':
        contactListeners.forEach((f) => f(msg))
        break
      case 'salto':
        useLive.getState().set({ ultimoSalto: msg.salto })
        jumpListeners.forEach((f) => f(msg.salto))
        break
    }
  }
  ws.onclose = () => {
    useLive.getState().set({ conectadoWs: false })
    setTimeout(open, Math.min(4000, 400 * 2 ** retry++))
  }
}

export function startLive() {
  if (started) return
  started = true
  open()
  setInterval(() => ws?.readyState === 1 && ws.send('ping'), 10000)
}
