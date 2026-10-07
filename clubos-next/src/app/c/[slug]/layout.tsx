import type { Metadata } from 'next';
import '@/styles/app.css';
import '@/styles/design-system.css';
import '@/styles/player.css';
import { PlayerTabBar } from '@/components/player/PlayerTabBar';
import { InstallPrompt } from '@/components/player/InstallPrompt';
import { PlayerSessionBoot } from '@/components/player/PlayerSessionBoot';
import { publicApi } from '@/lib/publicApi';

/**
 * `manifest` es dinámico (uno por club, ver manifest.webmanifest/route.ts)
 * así que no puede ser el objeto `metadata` estático de siempre —
 * `generateMetadata` es la variante que sí recibe `params`.
 *
 * El título y el ícono de iOS ("apple-touch-icon", que no lee el manifest
 * — Safari usa esta meta aparte) también salen del logo del club, mismo
 * criterio que el manifest de Android/desktop.
 */
export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const club = await publicApi.getClub(slug).catch(() => null);
  const name = club?.name ?? 'PadelApp2';

  return {
    title: name,
    description: 'Reservá tu cancha, anotate a torneos y mirá el buffet.',
    // Portal público: a diferencia del panel de staff, sí queremos que un
    // buscador lo indexe — es el punto de entrada para un jugador nuevo.
    robots: { index: true, follow: true },
    appleWebApp: { capable: true, statusBarStyle: 'default', title: name },
    icons: { apple: club?.logoUrl ?? '/icons/apple-touch-icon.png' },
    manifest: `/c/${slug}/manifest.webmanifest`,
  };
}

export const viewport = {
  themeColor: '#de6435',
};

/**
 * Layout del portal del jugador (`/c/[slug]/...`).
 *
 * Deliberadamente NO usa AppShell ni nada del panel de staff: este portal
 * tiene que funcionar con cero cookies/tokens de la app de staff (reservar
 * sí exige cuenta de JUGADOR — ver PlayerAuthGate en page.tsx — pero esa es
 * una sesión completamente distinta). `.player-shell`/`.player-main` son
 * el único armazón visual, definidos en player.css.
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
      <div className="player-frame">
        <main className="player-main">{children}</main>
        <PlayerSessionBoot />
        <InstallPrompt />
        <PlayerTabBar slug={slug} />
      </div>
    </div>
  );
}
