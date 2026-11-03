import { useApp } from './store'

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const tok = useApp.getState().proToken
  if (tok) headers['x-pro-token'] = tok
  const r = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  if (!r.ok) {
    let msg = r.statusText
    try {
      const j = await r.json()
      msg = typeof j.detail === 'string' ? j.detail : msg
    } catch {
      /* sin cuerpo */
    }
    throw new Error(msg)
  }
  return r.json() as Promise<T>
}

export const api = {
  get: <T,>(u: string) => req<T>('GET', u),
  post: <T,>(u: string, b?: unknown) => req<T>('POST', u, b ?? {}),
  put: <T,>(u: string, b?: unknown) => req<T>('PUT', u, b ?? {}),
  del: <T,>(u: string) => req<T>('DELETE', u),
}
