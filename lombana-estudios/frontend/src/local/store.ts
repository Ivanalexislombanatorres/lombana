// Almacén local: caché en memoria + persistencia en la base de datos del artifact (capability `db`).
// Cada registro es un documento JSON. Las colecciones se cargan completas la primera vez que se usan.

export type Doc = Record<string, unknown>

export interface Backend {
  list(collection: string): Promise<{ id: string; data: Doc }[]>
  set(path: string, data: Doc): Promise<void>
  remove(path: string): Promise<void>
  kind: 'artifact' | 'memory'
}

type DbLike = {
  collection(p: string): { get(): Promise<{ docs: { id: string; exists: boolean; data(): Doc | undefined }[] }> }
  doc(p: string): { set(d: Doc): Promise<void>; delete(): Promise<void> }
}

export class ArtifactBackend implements Backend {
  kind = 'artifact' as const
  private db: DbLike
  constructor(db: DbLike) { this.db = db }
  async list(collection: string) {
    const snap = await this.retry(() => this.db.collection(collection).get())
    return snap.docs.filter(d => d.exists).map(d => ({ id: d.id, data: structuredClone(d.data() ?? {}) }))
  }
  set(path: string, data: Doc) { return this.retry(() => this.db.doc(path).set(data)) }
  remove(path: string) { return this.retry(() => this.db.doc(path).delete()) }
  private async retry<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn() } catch (e) {
      const code = (e as { code?: string })?.code
      if (code === 'unavailable') { await new Promise(r => setTimeout(r, 400 + Math.random() * 600)); return fn() }
      if (code === 'quota_exceeded') throw new Error('Se llenó el espacio de la base de datos del artifact. Borra respaldos antiguos.')
      if (code === 'invalid_argument') throw new Error('La base de datos rechazó el dato (puede ser demasiado grande, máximo 256 KB por registro).')
      throw new Error((e as { message?: string })?.message || 'No se pudo guardar en la base de datos')
    }
  }
}

export class MemoryBackend implements Backend {
  kind = 'memory' as const
  data = new Map<string, Doc>()
  async list(collection: string) {
    const depth = collection.split('/').length + 1
    return [...this.data.entries()]
      .filter(([p]) => p.startsWith(collection + '/') && p.split('/').length === depth)
      .map(([p, d]) => ({ id: p.split('/').pop()!, data: structuredClone(d) }))
  }
  async set(path: string, data: Doc) { this.data.set(path, structuredClone(data)) }
  async remove(path: string) { this.data.delete(path) }
}

export class Store {
  private cache = new Map<string, Map<string, Doc>>()
  private loading = new Map<string, Promise<void>>()
  private queue = new Map<string, Promise<void>>()
  private pending = 0
  backend: Backend
  constructor(backend: Backend) { this.backend = backend }

  async load(collection: string) {
    if (this.cache.has(collection)) return
    if (!this.loading.has(collection)) {
      this.loading.set(collection, (async () => {
        const rows = await this.backend.list(collection)
        this.cache.set(collection, new Map(rows.map(r => [r.id, r.data])))
      })())
    }
    await this.loading.get(collection)
  }

  /** Registros de una colección (ya cargada), ordenados por id numérico. */
  all<T = Doc>(collection: string): T[] {
    const m = this.cache.get(collection)
    if (!m) throw new Error(`Colección no cargada: ${collection}`)
    return [...m.entries()].sort((a, b) => Number(a[0]) - Number(b[0]) || a[0].localeCompare(b[0])).map(([, d]) => d as T)
  }
  get<T = Doc>(collection: string, id: string | number): T | undefined {
    return this.cache.get(collection)?.get(String(id)) as T | undefined
  }
  nextId(collection: string): number {
    const m = this.cache.get(collection)!
    let max = 0
    for (const k of m.keys()) { const n = Number(k); if (n > max) max = n }
    return max + 1
  }
  /** Guarda (crea o reemplaza) un registro. Espera la confirmación de la base. */
  async put(collection: string, id: string | number, data: Doc) {
    await this.load(collection)
    this.cache.get(collection)!.set(String(id), data)
    await this.serial(`${collection}/${id}`, () => this.backend.set(`${collection}/${id}`, data))
  }
  async del(collection: string, id: string | number) {
    await this.load(collection)
    this.cache.get(collection)!.delete(String(id))
    await this.serial(`${collection}/${id}`, () => this.backend.remove(`${collection}/${id}`))
  }
  /** Una escritura a la vez por documento (regla de la base del artifact). */
  private serial(path: string, fn: () => Promise<void>) {
    const prev = this.queue.get(path) ?? Promise.resolve()
    this.pending++
    const next = prev.catch(() => {}).then(fn).finally(() => { this.pending-- })
    this.queue.set(path, next)
    return next
  }
  /** Olvida la caché para releer de la base (cambios hechos desde otra pestaña o desde el chat). */
  invalidate(): boolean {
    if (this.pending > 0) return false
    this.cache.clear(); this.loading.clear()
    return true
  }
}
