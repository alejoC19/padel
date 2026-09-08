import type { Metadata } from 'next';
import '@/styles/app.css';
import '@/styles/design-system.css';
import '@/styles/player.css';
import { JugadorTabBar } from '@/components/player/JugadorTabBar';
import { InstallPrompt } from '@/components/player/InstallPrompt';

export const metadata: Metadata = {
  title: 'ClubOS — Encontrá tu club',
  description: 'Buscá cualquier club de pádel de ClubOS y mirá tus reservas — una sola app para todos los clubes en los que jugás.',
  robots: { index: true, follow: true },
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'ClubOS' },
  icons: { apple: '/icons/apple-touch-icon.png' },
  manifest: '/jugador/manifest.webmanifest',
};

export const viewport = {
  themeColor: '#0ea5a0',
};

/**
 * Layout de la app UNIFICADA del jugador (`/jugador`).
 *
 * Distinta de `/c/[slug]`: esa es la página de reserva de UN club (la que
 * un club comparte en su propio sitio/redes, sin login, con su propia PWA).
 * Esta es el punto de entrada para alguien que todavía no eligió club, o
 * que juega en varios — busca cualquier club dado de alta en la
 * plataforma y ve sus reservas en todos ellos con una sola instalación.
 */
export default function JugadorLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="player-shell">
      <main className="player-main">{children}</main>
      <InstallPrompt />
      <JugadorTabBar />
    </div>
  );
}
