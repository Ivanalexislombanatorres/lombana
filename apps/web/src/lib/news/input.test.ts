import { describe, expect, it } from 'vitest';
import { parseReferenceUrls } from './input';

describe('parseReferenceUrls', () => {
  it('acepta enlaces https, uno por línea, sin duplicados', () => {
    expect(parseReferenceUrls('https://a.com/x\n\n  https://a.com/x \r\nhttp://b.org')).toEqual({
      urls: ['https://a.com/x', 'http://b.org/'],
    });
    expect(parseReferenceUrls('')).toEqual({ urls: [] });
  });
  it.each([
    ['javascript:alert(1)', 'https://'],
    ['ftp://a.com', 'https://'],
    ['no es url', 'no válido'],
    ['https://user:pw@a.com', 'usuario'],
    [Array.from({ length: 6 }, (_, i) => `https://a.com/${i}`).join('\n'), 'Máximo 5'],
  ])('rechaza %j', (input, fragment) => {
    const r = parseReferenceUrls(input);
    expect('error' in r && r.error).toContain(fragment);
  });
});
