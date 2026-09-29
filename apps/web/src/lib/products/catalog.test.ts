import { describe, expect, it } from 'vitest';
import { formatMinor, parsePriceToMinor, slugify } from './catalog';

describe('parsePriceToMinor', () => {
  it.each([
    ['5', 500], ['5.00', 500], ['5,5', 550], ['12.99', 1299], ['US$ 7', 700], ['$10', 1000], ['0', 0],
  ])('%s → %d', (input, minor) => expect(parsePriceToMinor(input)).toBe(minor));

  it.each(['', 'abc', '5.999', '-5', '1e3', '5.', '.5', '1000000', '5 000'])('rechaza %j', (input) =>
    expect(parsePriceToMinor(input)).toBeNull());
});

describe('formatMinor', () => {
  it('muestra gratis, dólares y ausencia de precio', () => {
    expect(formatMinor(0)).toBe('Gratis');
    expect(formatMinor(500)).toBe('US$5.00');
    expect(formatMinor('1299')).toBe('US$12.99');
    expect(formatMinor(null)).toBe('Sin precio');
  });
});

describe('slugify', () => {
  it('produce slugs válidos para la base', () => {
    const re = /^[a-z0-9]([a-z0-9-]{1,78}[a-z0-9])?$/;
    for (const t of ['Guía de Costos para Restaurantes', '¡¡¡!!!', 'Ñandú & Café', 'x'.repeat(200)]) {
      const s = slugify(t, 'a1b2c3');
      expect(s).toMatch(re);
    }
    expect(slugify('Guía de Costos', 'a1b2c3')).toBe('guia-de-costos-a1b2c3');
    expect(slugify('¡¡¡', 'a1b2c3')).toBe('producto-a1b2c3');
  });
});
