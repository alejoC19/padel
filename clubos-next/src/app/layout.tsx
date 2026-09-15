import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ClubOS',
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
      <body>{children}</body>
    </html>
  );
}
