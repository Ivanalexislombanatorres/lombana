export function Brand({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <span className="brand" style={size === 'lg' ? { fontSize: 16 } : undefined}>
      <span className="brand-mark" aria-hidden>
        L
      </span>
      <span>
        LOMBANA <span className="brand-ai">AI</span>
      </span>
    </span>
  );
}

export const INTENTS = [
  { key: 'crear', label: 'Crear', example: 'Quiero crear un ebook para dueños de restaurantes sobre control de costos' },
  { key: 'automatizar', label: 'Automatizar', example: 'Quiero automatizar el seguimiento de clientes de mi negocio' },
  { key: 'vender', label: 'Vender', example: 'Quiero vender plantillas de Excel para pequeñas empresas' },
  { key: 'analizar', label: 'Analizar', example: 'Quiero analizar las ventas de mi tienda de los últimos meses' },
  { key: 'aprender', label: 'Aprender', example: 'Quiero aprender a usar inteligencia artificial en mi trabajo' },
  { key: 'encontrar', label: 'Encontrar', example: 'Necesito una herramienta para controlar el inventario' },
  { key: 'resolver', label: 'Resolver', example: 'Necesito ordenar las finanzas de mi emprendimiento' },
] as const;

export type IntentKey = (typeof INTENTS)[number]['key'];

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    READY: ['badge-ready', 'Disponible'],
    TESTING: ['badge-dev', 'En pruebas'],
    IN_DEVELOPMENT: ['badge-dev', 'En desarrollo'],
    PLANNED: ['badge-planned', 'Planeado'],
    BLOCKED: ['badge-blocked', 'Bloqueado'],
    DEPRECATED: ['badge-planned', 'Retirado'],
  };
  const [cls, label] = map[status] ?? ['badge-planned', status];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export const PROJECT_STATUS_LABEL: Record<string, string> = {
  IDEA: 'Idea',
  INVESTIGACION: 'Investigación',
  VALIDACION: 'Validación',
  DISENO: 'Diseño',
  DESARROLLO: 'Desarrollo',
  REVISION: 'Revisión',
  PUBLICACION: 'Publicación',
  ACTIVO: 'Activo',
  PAUSADO: 'Pausado',
  FINALIZADO: 'Finalizado',
};
