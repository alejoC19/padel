import type { Metadata, Viewport } from 'next';
import './globals.css';
import { THEME_INIT_SCRIPT } from '@/lib/theme';

export const metadata: Metadata = {
  title: 'PadelApp2',
  description: 'Sistema de gestión para clubes de pádel.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

/**
 * Layout raíz de la app. Next.js EXIGE que exista y que provea las etiquetas
 * <html> y <body> que envuelven todo. Los layouts de cada sección (agenda,
 * entrar, crear-club…) se anidan dentro de este.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <head>
        {/* eslint-disable-next-line react/no-danger */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
