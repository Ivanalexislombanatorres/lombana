import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'LOMBANA AI',
  description: 'Ecosistema digital: convertir ideas en resultados reales.',
};

// Layout provisional. El sistema de diseño y el layout real son el paso 4 de V1.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body style={{ margin: 0, background: '#05070d', color: '#e8ecf5', fontFamily: 'system-ui, sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
