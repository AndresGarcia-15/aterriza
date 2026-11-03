import { create } from 'zustand'
import type { Atleta, SaltoEvento, Status } from './types'

const read = (k: string) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k)
    else localStorage.setItem(k, v)
  } catch {
    /* almacenamiento no disponible */
  }
}

interface AppState {
  atleta: Atleta | null
  setAtleta: (a: Atleta | null) => void
  tema: 'dark' | 'light'
  toggleTema: () => void
  proToken: string | null
  setProToken: (t: string | null) => void
}

export const useApp = create<AppState>((set, get) => ({
  atleta: (() => {
    const s = read('atleta')
    return s ? (JSON.parse(s) as Atleta) : null
  })(),
  setAtleta: (a) => {
    write('atleta', a ? JSON.stringify(a) : null)
    set({ atleta: a })
  },
  tema: (document.documentElement.dataset.theme as 'dark' | 'light') || 'dark',
  toggleTema: () => {
    const t = get().tema === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = t
    write('tema', t)
    set({ tema: t })
  },
  proToken: sessionStorage.getItem('pro') || null,
  setProToken: (t) => {
    if (t) sessionStorage.setItem('pro', t)
    else sessionStorage.removeItem('pro')
    set({ proToken: t })
  },
}))

interface LiveState {
  conectadoWs: boolean
  status: Status | null
  ultimoSalto: SaltoEvento | null
  set: (p: Partial<LiveState>) => void
}

export const useLive = create<LiveState>((set) => ({
  conectadoWs: false,
  status: null,
  ultimoSalto: null,
  set: (p) => set(p),
}))
