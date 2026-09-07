import type { Metadata } from 'next';
import '@/styles/app.css';
import '@/styles/design-system.css';
import '@/styles/player.css';

export const metadata: Metadata = {
  title: 'Reservar cancha',
  description: 'Reservá tu cancha de pádel online, sin registrarte.',
  // Portal público: a diferencia del panel de staff, sí queremos que un
  // buscador lo indexe — es el punto de entrada para un jugador nuevo.
  robots: { index: true, follow: true },
};

/**
 * Layout del portal del jugador (`/c/[slug]/...`).
 *
 * Deliberadamente NO usa AppShell ni nada del panel de staff: este portal es
 * público y sin sesión, tiene que funcionar con cero cookies/tokens de la
 * app de staff. `.player-shell`/`.player-main` son el único armazón visual,
 * definidos en player.css.
 */
export default function PlayerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="player-shell">
      <main className="player-main">{children}</main>
    </div>
  );
}
