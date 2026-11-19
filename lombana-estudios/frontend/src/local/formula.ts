// Motor de fórmulas restringido (misma semántica que backend/app/formulas/engine.py).
// Analizador propio de expresiones: NUNCA usa eval ni Function. Todo número es Decimal.
import DecimalBase from 'decimal.js'

export const D = DecimalBase.clone({ precision: 28, rounding: DecimalBase.ROUND_HALF_UP })
export type Dec = InstanceType<typeof D>
export class FormulaError extends Error {}

const MAX_LEN = 500, MAX_NODES = 200, MAX_ABS = new D('1e15'), HUNDRED = new D(100)
type Val = Dec | boolean
type Node =
  | { t: 'num'; v: string } | { t: 'name'; v: string } | { t: 'un'; op: string; a: Node }
  | { t: 'bin'; op: string; a: Node; b: Node } | { t: 'cmp'; first: Node; rest: [string, Node][] }
  | { t: 'bool'; op: 'and' | 'or'; items: Node[] } | { t: 'call'; f: string; args: Node[] }

const dec = (x: Val): Dec => {
  if (typeof x === 'boolean') throw new FormulaError('Se esperaba un número y se recibió un valor lógico')
  return x
}
function toDec(v: unknown): Val {
  if (typeof v === 'boolean') return v
  try { const d = new D(String(v)); if (!d.isFinite()) throw 0; return d } catch { throw new FormulaError(`Valor numérico inválido: ${String(v)}`) }
}

const FUNCS: Record<string, [(...a: Val[]) => Val, string]> = {
  SI: [() => { throw new Error('perezosa') }, 'SI(condición, valor_si, valor_no)'],
  SUMA: [(...xs) => xs.reduce<Dec>((s, x) => s.plus(dec(x)), new D(0)), 'SUMA(a, b, ...)'],
  PROMEDIO: [(...xs) => { if (!xs.length) throw new FormulaError('PROMEDIO necesita al menos un valor'); return xs.reduce<Dec>((s, x) => s.plus(dec(x)), new D(0)).div(xs.length) }, 'PROMEDIO(a, b, ...)'],
  MIN: [(...xs) => { if (!xs.length) throw new TypeError(); return D.min(...xs.map(dec)) }, 'MIN(a, b, ...)'],
  MAX: [(...xs) => { if (!xs.length) throw new TypeError(); return D.max(...xs.map(dec)) }, 'MAX(a, b, ...)'],
  ABS: [(...a) => { arity(a, 1); return dec(a[0]).abs() }, 'ABS(x)'],
  REDONDEAR: [(...a) => {
    if (a.length < 1 || a.length > 2) throw new TypeError()
    const n = a.length === 2 ? dec(a[1]).toNumber() : 2
    if (!Number.isInteger(n) || n < 0 || n > 8) throw new FormulaError('REDONDEAR admite entre 0 y 8 decimales')
    return dec(a[0]).toDecimalPlaces(n, D.ROUND_HALF_UP)
  }, 'REDONDEAR(x, decimales)'],
  PORCENTAJE: [(...a) => { arity(a, 2); return dec(a[0]).times(dec(a[1])).div(HUNDRED) }, 'PORCENTAJE(base, %) → valor del %'],
  IMPUESTO: [(...a) => { arity(a, 2); return dec(a[0]).times(dec(a[1])).div(HUNDRED) }, 'IMPUESTO(base, tasa%) → valor del impuesto'],
  CON_IMPUESTO: [(...a) => { arity(a, 2); return dec(a[0]).times(dec(a[1]).div(HUNDRED).plus(1)) }, 'CON_IMPUESTO(base, tasa%) → base + impuesto'],
  DESCUENTO: [(...a) => { arity(a, 2); return dec(a[0]).times(new D(1).minus(dec(a[1]).div(HUNDRED))) }, 'DESCUENTO(base, %) → base con descuento'],
  COMISION: [(...a) => { arity(a, 2); return dec(a[0]).times(dec(a[1])).div(HUNDRED) }, 'COMISION(ventas, %)'],
  MARGEN: [(...a) => { arity(a, 2); const p = dec(a[0]); if (p.isZero()) throw new FormulaError('MARGEN: el precio no puede ser cero'); return p.minus(dec(a[1])).div(p).times(HUNDRED) }, 'MARGEN(precio, costo) → % de margen'],
  RENTABILIDAD: [(...a) => { arity(a, 2); const i = dec(a[1]); if (i.isZero()) throw new FormulaError('RENTABILIDAD: la inversión no puede ser cero'); return dec(a[0]).div(i).times(HUNDRED) }, 'RENTABILIDAD(utilidad, inversión) → %'],
  Y: [(...xs) => xs.every(Boolean), 'Y(cond1, cond2, ...)'],
  O: [(...xs) => xs.some(Boolean), 'O(cond1, cond2, ...)'],
  NO: [(...a) => { arity(a, 1); return !a[0] }, 'NO(cond)'],
}
function arity(a: unknown[], n: number) { if (a.length !== n) throw new TypeError() }

// ------------------------------------------------------------------ análisis
type Tok = { k: 'num' | 'id' | 'op' | 'end'; v: string; pos: number }
function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) { i++; continue }
    const num = /^(\d+\.?\d*(e[+-]?\d+)?|\.\d+(e[+-]?\d+)?)/i.exec(src.slice(i))
    if (num) { out.push({ k: 'num', v: num[0], pos: i }); i += num[0].length; continue }
    const id = /^[A-Za-z_áéíóúñÁÉÍÓÚÑ][A-Za-z0-9_áéíóúñÁÉÍÓÚÑ]*/.exec(src.slice(i))
    if (id) { out.push({ k: 'id', v: id[0], pos: i }); i += id[0].length; continue }
    const op = /^(\*\*|>=|<=|==|!=|[-+*/%(),<>])/.exec(src.slice(i))
    if (op) { out.push({ k: 'op', v: op[0], pos: i }); i += op[0].length; continue }
    if (c === '"' || c === "'") throw new FormulaError('Solo se permiten constantes numéricas')
    throw new FormulaError(`Elemento no permitido en fórmulas: "${c}"`)
  }
  out.push({ k: 'end', v: '', pos: src.length })
  return out
}

export function parse(expression: string): Node {
  if (typeof expression !== 'string' || !expression.trim()) throw new FormulaError('La fórmula está vacía')
  if (expression.length > MAX_LEN) throw new FormulaError(`La fórmula supera ${MAX_LEN} caracteres`)
  const toks = tokenize(expression.trim())
  let p = 0, nodes = 0
  const peek = () => toks[p]
  const next = () => toks[p++]
  const node = <T extends Node>(n: T): T => { if (++nodes > MAX_NODES) throw new FormulaError('La fórmula es demasiado compleja'); return n }
  const expect = (v: string) => { const t = next(); if (t.v !== v) throw new FormulaError(`Error de sintaxis en la posición ${t.pos + 1}: revisa paréntesis y operadores`) }
  const isKw = (v: string) => peek().k === 'id' && peek().v === v

  const orE = (): Node => { const items = [andE()]; while (isKw('or')) { next(); items.push(andE()) } return items.length > 1 ? node({ t: 'bool', op: 'or', items }) : items[0] }
  const andE = (): Node => { const items = [notE()]; while (isKw('and')) { next(); items.push(notE()) } return items.length > 1 ? node({ t: 'bool', op: 'and', items }) : items[0] }
  const notE = (): Node => { if (isKw('not')) { next(); return node({ t: 'un', op: 'not', a: notE() }) } return cmpE() }
  const cmpE = (): Node => {
    const first = sumE(); const rest: [string, Node][] = []
    while (['>', '>=', '<', '<=', '==', '!='].includes(peek().v) && peek().k === 'op') { const op = next().v; rest.push([op, sumE()]) }
    return rest.length ? node({ t: 'cmp', first, rest }) : first
  }
  const sumE = (): Node => { let a = termE(); while (peek().k === 'op' && (peek().v === '+' || peek().v === '-')) { const op = next().v; a = node({ t: 'bin', op, a, b: termE() }) } return a }
  const termE = (): Node => { let a = unaryE(); while (peek().k === 'op' && ['*', '/', '%'].includes(peek().v)) { const op = next().v; a = node({ t: 'bin', op, a, b: unaryE() }) } return a }
  const unaryE = (): Node => { if (peek().k === 'op' && (peek().v === '-' || peek().v === '+')) { const op = next().v; return node({ t: 'un', op, a: unaryE() }) } return powE() }
  const powE = (): Node => { const a = atom(); if (peek().k === 'op' && peek().v === '**') { next(); return node({ t: 'bin', op: '**', a, b: unaryE() }) } return a }
  const atom = (): Node => {
    const t = next()
    if (t.k === 'num') return node({ t: 'num', v: t.v })
    if (t.k === 'id') {
      if (['and', 'or', 'not', 'if', 'else', 'lambda', 'import'].includes(t.v)) throw new FormulaError(`Elemento no permitido en fórmulas: ${t.v}`)
      if (peek().v === '(' && peek().k === 'op') {
        next()
        if (!(t.v in FUNCS)) throw new FormulaError(`Función no autorizada: ${t.v}`)
        const args: Node[] = []
        if (peek().v !== ')') { args.push(orE()); while (peek().v === ',') { next(); args.push(orE()) } }
        expect(')')
        return node({ t: 'call', f: t.v, args })
      }
      if (t.v.startsWith('_')) throw new FormulaError('Nombre de variable inválido')
      return node({ t: 'name', v: t.v })
    }
    if (t.v === '(') { const e = orE(); expect(')'); return e }
    throw new FormulaError(`Error de sintaxis en la posición ${t.pos + 1}: revisa paréntesis y operadores`)
  }
  const tree = orE()
  if (peek().k !== 'end') throw new FormulaError(`Error de sintaxis en la posición ${peek().pos + 1}: revisa paréntesis y operadores`)
  return tree
}

function walk(n: Node, f: (n: Node) => void) {
  f(n)
  if (n.t === 'un') walk(n.a, f)
  else if (n.t === 'bin') { walk(n.a, f); walk(n.b, f) }
  else if (n.t === 'cmp') { walk(n.first, f); n.rest.forEach(([, x]) => walk(x, f)) }
  else if (n.t === 'bool') n.items.forEach(x => walk(x, f))
  else if (n.t === 'call') n.args.forEach(x => walk(x, f))
}

export function variablesOf(expression: string): string[] {
  const s = new Set<string>()
  walk(parse(expression), n => { if (n.t === 'name') s.add(n.v) })
  return [...s].sort()
}

export function validate(expression: string, declared?: string[]): string[] {
  const used = variablesOf(expression)
  if (declared) {
    const missing = used.filter(v => !declared.includes(v))
    if (missing.length) throw new FormulaError(`Variables no declaradas: ${missing.join(', ')}`)
  }
  return used
}

export function evaluate(expression: string, values: Record<string, unknown>): Val {
  const tree = parse(expression)
  const vals: Record<string, Val> = {}
  for (const [k, v] of Object.entries(values)) vals[k] = toDec(v)
  const ev = (n: Node): Val => {
    switch (n.t) {
      case 'num': return new D(n.v)
      case 'name': if (!(n.v in vals)) throw new FormulaError(`Falta el valor de la variable '${n.v}'`); return vals[n.v]
      case 'un': { const v = ev(n.a); return n.op === 'not' ? !v : n.op === '-' ? dec(v).neg() : dec(v) }
      case 'bin': {
        const a = dec(ev(n.a)), b = dec(ev(n.b))
        if (n.op === '**') { if (!b.isInteger() || b.abs().gt(12)) throw new FormulaError('Potencias: solo exponentes enteros entre -12 y 12'); return a.pow(b) }
        if ((n.op === '/' || n.op === '%') && b.isZero()) throw new FormulaError('División por cero o operación inválida')
        return n.op === '+' ? a.plus(b) : n.op === '-' ? a.minus(b) : n.op === '*' ? a.times(b) : n.op === '/' ? a.div(b) : a.mod(b)
      }
      case 'cmp': {
        let left = ev(n.first)
        for (const [op, x] of n.rest) {
          const right = ev(x)
          const c = typeof left === 'boolean' || typeof right === 'boolean' ? (left === right ? 0 : NaN) : left.cmp(right)
          const ok = op === '>' ? c > 0 : op === '>=' ? c >= 0 : op === '<' ? c < 0 : op === '<=' ? c <= 0 : op === '==' ? c === 0 : c !== 0
          if (!ok) return false
          left = right
        }
        return true
      }
      case 'bool': return n.op === 'and' ? n.items.every(x => Boolean(ev(x))) : n.items.some(x => Boolean(ev(x)))
      case 'call': {
        if (n.f === 'SI') { if (n.args.length !== 3) throw new FormulaError('SI necesita 3 argumentos'); return ev(n.args[0]) ? ev(n.args[1]) : ev(n.args[2]) }
        try { return FUNCS[n.f][0](...n.args.map(ev)) } catch (e) {
          if (e instanceof TypeError) throw new FormulaError(`Número de argumentos incorrecto en ${n.f}. Uso: ${FUNCS[n.f][1]}`)
          throw e
        }
      }
    }
  }
  const r = ev(tree)
  if (typeof r !== 'boolean') {
    if (!r.isFinite()) throw new FormulaError('División por cero o operación inválida')
    if (r.abs().gt(MAX_ABS)) throw new FormulaError('El resultado excede el límite permitido')
  }
  return r
}

export const catalog = () => Object.entries(FUNCS).map(([name, [, usage]]) => ({ name, usage }))
export const fmt = (v: Val) => (typeof v === 'boolean' ? v : v.toFixed())
