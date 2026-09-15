import type { Metadata, Viewport } from 'next';
import { Inter, Inter_Tight } from 'next/font/google';
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
 * Tipografía de marca.
 *
 * Antes no había ninguna: todo corría en `system-ui`, la fuente por
 * defecto de cualquier dashboard genérico (Segoe en Windows, San Francisco
 * en Mac) — cero personalidad, imposible de reconocer como ClubOS.
 *
 * Inter Tight ya estaba referenciada como fuente de marca en el arte de la
 * landing (`NotebookScene`, ver marketing/Art.tsx) pero nunca se llegó a
 * cargar de verdad en la app. Se usa para títulos, números grandes y la
 * marca — tiene el peso condensado que le da carácter a un número de caja.
 * Inter (variable ancha, sin condensar) queda para el cuerpo: a densidad
 * alta de datos (tablas, formularios) la legibilidad manda por sobre el
 * carácter.
 *
 * `next/font` las descarga UNA vez en build y las sirve desde el propio
 * dominio — no hay llamada a Google Fonts en runtime.
 */
const interTight = Inter_Tight({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

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
    <html lang="es" className={`${interTight.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
