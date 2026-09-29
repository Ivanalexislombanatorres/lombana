// Normalización de aportes al periódico (pura, con pruebas unitarias).

export const NEWS_TOPICS = {
  ia: 'Inteligencia artificial',
  software: 'Software',
  startups: 'Startups',
  ciberseguridad: 'Ciberseguridad',
  hardware: 'Hardware',
  negocios_digitales: 'Negocios digitales',
  otros: 'Otros',
} as const;
export type NewsTopic = keyof typeof NEWS_TOPICS;

export const CONTRIBUTION_STATUS_LABEL: Record<string, string> = {
  draft: 'Borrador',
  submitted: 'En moderación',
  approved: 'Publicado',
  rejected: 'No aprobado',
  withdrawn: 'Retirado',
};

/** Una URL por línea; solo http(s), sin duplicados, máximo 5. Devuelve error si alguna no es válida. */
export function parseReferenceUrls(text: string): { urls: string[] } | { error: string } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length > 5) return { error: 'Máximo 5 enlaces de referencia.' };
  const urls: string[] = [];
  for (const line of lines) {
    let u: URL;
    try {
      u = new URL(line);
    } catch {
      return { error: `Enlace no válido: ${line.slice(0, 80)}` };
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'Los enlaces deben empezar por https://' };
    if (u.username || u.password) return { error: 'Los enlaces no pueden incluir usuario o contraseña.' };
    const href = u.toString();
    if (href.length > 500) return { error: 'Enlace demasiado largo.' };
    if (!urls.includes(href)) urls.push(href);
  }
  return { urls };
}
