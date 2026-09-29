// Catálogos y reglas puras del Product Lab (sin acceso a la base: se prueban unitariamente).

export const PRODUCT_TYPES = {
  ebook: 'Ebook',
  template: 'Plantilla',
  pack: 'Pack',
  prompts: 'Prompts',
  checklist: 'Checklist',
  course_material: 'Material de curso',
  spec: 'Especificación',
  service: 'Servicio',
  other: 'Otro',
} as const;
export type ProductType = keyof typeof PRODUCT_TYPES;

export const PRODUCT_CATEGORIES = {
  negocios: 'Negocios',
  marketing: 'Marketing',
  finanzas: 'Finanzas',
  productividad: 'Productividad',
  tecnologia: 'Tecnología',
  educacion: 'Educación',
  otros: 'Otros',
} as const;
export type ProductCategory = keyof typeof PRODUCT_CATEGORIES;

export const PRODUCT_STATUS_LABEL: Record<string, string> = {
  draft: 'Borrador',
  in_review: 'En revisión',
  published: 'Publicado',
  paused: 'Pausado',
  archived: 'Archivado',
};

/**
 * Convierte un precio escrito por una persona ("5", "5.50", "5,5", "US$ 12") a centavos.
 * Devuelve null si no es un monto válido. Máximo 2 decimales y hasta US$100.000.
 */
export function parsePriceToMinor(input: string): number | null {
  const clean = input.trim().replace(/^(us\$|usd|\$)\s*/i, '').replace(',', '.');
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(clean)) return null;
  const [whole, frac = ''] = clean.split('.');
  const minor = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(minor) || minor > 10_000_000) return null;
  return minor;
}

export function formatMinor(minor: number | string | null | undefined, currency = 'USD'): string {
  if (minor === null || minor === undefined) return 'Sin precio';
  const n = Number(minor);
  if (n === 0) return 'Gratis';
  return `${currency === 'USD' ? 'US$' : `${currency} `}${(n / 100).toFixed(2)}`;
}

/** Slug público: minúsculas, sin tildes, guiones, y un sufijo aleatorio para que sea único. */
export function slugify(title: string, suffix: string): string {
  const base = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return `${base || 'producto'}-${suffix}`;
}
