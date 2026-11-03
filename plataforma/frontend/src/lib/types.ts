export type Estado = 'ok' | 'parcial' | 'no' | 'no_disponible'

export interface Atleta {
  id: number
  nombre: string
  deporte: string
  pierna_dominante: string
  estatura_cm: number | null
  masa_kg: number | null
  creado?: string
  saltos?: number
  ultimo_indice?: number | null
  ultima_categoria?: string | null
}

export interface Item {
  id: string
  item: number
  nombre: string
  grupo: string
  estado: Estado
  valor: number | null
  meta: number
  unidad: string
  peso: number
  porque: string
  fuente: string
  mensaje?: string
  impacto?: number
  etiqueta?: string
  tipo: string
}

export interface Resultado {
  indice: number
  categoria: string
  estado: 'ok' | 'parcial' | 'no'
  items: Item[]
  acciones: Item[]
  fortalezas: Item[]
  confianza: 'alta' | 'media' | 'baja'
  motivos_confianza: string[]
  avisos: { tipo: string; texto: string }[]
  rigidez: string | null
  metricas: Record<string, number | boolean | string | null>
  aviso: string
  no_disponible: { nombre: string; motivo: string }[]
  version_reglas: number
  unidad_carga: string
  banco?: { imus: Record<string, boolean>; usadas: string[]; texto: string }
  sensores?: { imus: Record<string, boolean>; usadas: string[]; faltan: string[]; texto: string }
  modo_salto?: 'cajon' | 'sitio'
}

export interface Serie {
  t: number[]
  knee: number[]
  trunk: number[]
  thigh: number[] | null
  valgus: number[] | null
  lateral: number[] | null
  fsr: number[][]
}

export interface SaltoDetalle {
  id: number
  sesion_id: number
  fecha: string
  resultado: Resultado
  serie: Serie
  escenario: string | null
  atleta: Atleta | null
  numero: number
  total: number
}

export interface Referencia {
  serie: Serie
  contacto: { rodilla: number; tronco: number }
  pico: { rodilla: number; tronco: number; t: number }
  origen: string
}

export interface LiveFrame {
  type: 'live'
  t: number
  knee: number
  trunk: number
  thigh: number | null
  valgus: number | null
  lateral: number | null
  fsr: number[]
  air: boolean
  air_t: number
  flags: number
  hw?: Hardware
}

/** Lecturas de hardware (Banco de pruebas). q: cuaternión [w,x,y,z] sensor→mundo (Z arriba). */
export interface Hardware {
  raw: number[]
  base: number | null
  q?: number[][]
  a?: number[]
  g?: number[]
  ok?: boolean[]
}

export interface Status {
  type: 'status'
  estado: string
  error: string
  fuente: string
  tipo: string | null
  hz: number
  fresco: boolean
  perdidas: number
  fsr: { id: string; ok: boolean; visto?: boolean; crudo: number; saturado: boolean }[]
  imu: { id: string; ok: boolean; error: boolean; ausente?: boolean; g: number }[]
  tara: boolean
  calibrando: boolean
  solo_giro: boolean
  tara_pendiente: boolean
  mensajes: string[]
  sesion: { id: number | null; conteo: number; objetivo: number; atleta: Atleta | null }
  demo: { escenario: number; auto: boolean; reproduciendo: boolean; escenarios: Record<string, string> } | null
  banco?: boolean
  modo_salto?: 'cajon' | 'sitio'
  virtual?: { fsr: number[]; imu: Record<string, boolean> } | null
}

export interface SaltoEvento {
  id: number | null
  fecha: string
  resultado: Resultado
  serie: Serie
  valido: boolean
  conteo: number
  objetivo: number
}
