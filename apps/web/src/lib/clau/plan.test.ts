import { describe, expect, it } from 'vitest';
import { parsePlan } from './plan';

const ok = {
  resumen: 'Lanzar un servicio de domicilios para restaurantes del barrio.',
  publico: 'Restaurantes pequeños',
  pasos: [
    { titulo: 'Entrevistar a 10 restaurantes', descripcion: 'Validar la necesidad', motor: 'search' },
    { titulo: 'Definir zonas y tarifas', descripcion: '', motor: 'data' },
    { titulo: 'Verificar permisos municipales', descripcion: 'Consultar la alcaldía', motor: 'tools' },
  ],
  riesgos: ['La demanda no está validada'],
};

describe('parsePlan', () => {
  it('acepta un plan válido, también dentro de ```json', () => {
    expect('plan' in parsePlan(JSON.stringify(ok))).toBe(true);
    expect('plan' in parsePlan('```json\n' + JSON.stringify(ok) + '\n```')).toBe(true);
  });
  it('corrige motores desconocidos y quita pasos repetidos', () => {
    const r = parsePlan(JSON.stringify({ ...ok, pasos: [...ok.pasos, { ...ok.pasos[0], motor: 'magia' }] }));
    expect('plan' in r && r.plan.pasos).toHaveLength(3);
    const r2 = parsePlan(JSON.stringify({ ...ok, pasos: ok.pasos.map((p) => ({ ...p, motor: 'x' })) }));
    expect('plan' in r2 && r2.plan.pasos.every((p) => p.motor === 'tools')).toBe(true);
  });
  it.each([
    ['texto libre', 'Claro, aquí tienes tu plan'],
    ['menos de 3 pasos', JSON.stringify({ ...ok, pasos: ok.pasos.slice(0, 2) })],
    ['sin resumen', JSON.stringify({ pasos: ok.pasos })],
    ['más de 10 pasos', JSON.stringify({ ...ok, pasos: Array.from({ length: 11 }, (_, i) => ({ titulo: `Paso ${i}`, motor: 'ai' })) })],
  ])('rechaza %s', (_n, text) => {
    expect('error' in parsePlan(text)).toBe(true);
  });
});
