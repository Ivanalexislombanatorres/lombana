import type { NextConfig } from 'next';

// Variables de entorno en producción (Vercel): DATABASE_URL, APP_ENV,
// NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY y SITE_URL.
// Las NEXT_PUBLIC_* se incrustan al compilar: cambiarlas exige un nuevo build.

const config: NextConfig = {
  // El paquete de base de datos es TypeScript del monorepo: Next lo compila.
  transpilePackages: ['@lombana/db'],
  serverExternalPackages: ['pg'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default config;
