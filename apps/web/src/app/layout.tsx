import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'LOMBANA AI', template: '%s · LOMBANA AI' },
  description: 'Ecosistema digital: convertir ideas en resultados reales.',
};

export const viewport: Viewport = { themeColor: '#05070d' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
