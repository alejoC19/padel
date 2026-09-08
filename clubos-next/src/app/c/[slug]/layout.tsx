import type { Metadata } from 'next';
import '@/styles/app.css';
import '@/styles/design-system.css';
import '@/styles/player.css';
import { PlayerTabBar } from '@/components/player/PlayerTabBar';
import { InstallPrompt } from '@/components/player/InstallPrompt';

/**
 * `manifest` es dinámico (uno por club, ver manifest.webmanifest/route.ts)
 * así que no puede ser el objeto `metadata` estático de siempre —
 * `generateMetadata` es la variante que sí recibe `params`.
 */
export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: 'ClubOS',
    description: 'Reservá tu cancha, anotate a torneos y mirá el buffet — sin registrarte.',
    // Portal público: a diferencia del panel de staff, sí queremos que un
    // buscador lo indexe — es el punto de entrada para un jugador nuevo.
    robots: { index: true, follow: true },
    appleWebApp: { capable: true, statusBarStyle: 'default', title: 'ClubOS' },
    icons: { apple: '/icons/apple-touch-icon.png' },
    manifest: `/c/${slug}/manifest.webmanifest`,
  };
}

export const viewport = {
  themeColor: '#c8443e',
};

/**
 * Layout del portal del jugador (`/c/[slug]/...`).
 *
 * Deliberadamente NO usa AppShell ni nada del panel de staff: este portal es
 * público y sin sesión, tiene que funcionar con cero cookies/tokens de la
 * app de staff. `.player-shell`/`.player-main` son el único armazón visual,
 * definidos en player.css.
 *
 * Es también la PWA instalable del jugador (ver InstallPrompt): el manifest
 * y el tabbar de abajo viven acá porque tienen que estar en TODAS las
 * pantallas del portal, no solo en la home.
 */
export default async function PlayerLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <div className="player-shell">
      <main className="player-main">{children}</main>
      <InstallPrompt />
      <PlayerTabBar slug={slug} />
    </div>
  );
}
