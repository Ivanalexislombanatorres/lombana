// Arranque de la versión dentro de Claude: conecta la base del artifact, Claude (sample) y descargas.
import { setDownloader, setLocalApi } from '../lib/api'
import { LocalApi, type Sampler } from './api'
import { ArtifactBackend, MemoryBackend, Store, type Backend } from './store'

type ClaudeRt = { use(name: string): Promise<unknown> }
const claude = (): ClaudeRt | null => (window as unknown as { claude?: ClaudeRt }).claude ?? null

export async function boot(): Promise<string | undefined> {
  const c = claude()
  let backend: Backend
  let banner: string | undefined
  const db = c ? await c.use('db').catch(() => null) : null
  if (db) backend = new ArtifactBackend(db as ConstructorParameters<typeof ArtifactBackend>[0])
  else {
    backend = new MemoryBackend()
    banner = 'Modo demostración: esta vista no tiene acceso a la base de datos del artifact, así que los cambios NO se guardarán al cerrar.'
  }
  let sampleP: Promise<Sampler> | null = null
  const sampler = () => (sampleP ??= (c ? c.use('sample').catch(() => null) : Promise.resolve(null)) as Promise<Sampler>)
  setDownloader(async () => {
    const d = c ? ((await c.use('downloads').catch(() => null)) as { save(f: { filename: string; data: string }): Promise<unknown> } | null) : null
    return d ? f => d.save(f) : null
  })
  const api = new LocalApi(new Store(backend), sampler)
  await withTimeout(api.init(), 20000, 'La base de datos del artifact no respondió. Recarga la página en unos segundos.')
  setLocalApi(api)
  // Si los datos cambiaron desde otra pestaña o desde el chat, se releen al volver a la página
  const refresh = () => { if (document.visibilityState === 'visible') api.store.invalidate() }
  document.addEventListener('visibilitychange', refresh)
  window.addEventListener('focus', refresh)
  return banner
}

function withTimeout<T>(p: Promise<T>, ms: number, msg: string) {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(msg)), ms))])
}
