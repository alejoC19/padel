'use client';

import { usePathname } from 'next/navigation';

/**
 * Navegación inferior del portal del jugador. A PROPÓSITO limitada a 3
 * secciones — turnos, torneos y buffet — porque es todo lo que el jugador
 * necesita ver en la app (no es el panel de staff). Vive en el layout de
 * `/c/[slug]`, así que aparece en todas las pantallas del portal.
 */
export function PlayerTabBar({ slug }: { slug: string }) {
  const pathname = usePathname();
  const base = `/c/${slug}`;

  const tabs = [
    { href: base, label: 'Turnos', match: (p: string) => p === base || p.startsWith(`${base}/reservas`) || p.startsWith(`${base}/mis-reservas`), icon: <CourtIcon /> },
    { href: `${base}/torneos`, label: 'Torneos', match: (p: string) => p.startsWith(`${base}/torneos`) || p.startsWith(`${base}/equipos`), icon: <CupIcon /> },
    { href: `${base}/buffet`, label: 'Buffet', match: (p: string) => p.startsWith(`${base}/buffet`), icon: <CupSodaIcon /> },
  ];

  return (
    <nav className="player-tabbar" aria-label="Navegación">
      <div className="player-tabbar-inner">
        {tabs.map((t) => {
          const active = t.match(pathname ?? '');
          return (
            <a key={t.href} href={t.href} className={`player-tab ${active ? 'is-active' : ''}`}>
              {t.icon}
              <span>{t.label}</span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}

function CourtIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M12 4v16M3 12h18" />
    </svg>
  );
}

function CupIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4Z" />
      <path d="M17 5h2a2 2 0 0 1 0 4h-2M7 5H5a2 2 0 0 0 0 4h2" />
    </svg>
  );
}

function CupSodaIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="m6 8 1.5 12h9L18 8" />
      <path d="M5 8h14l-1-4H6L5 8Z" />
      <path d="M12 4V2" />
    </svg>
  );
}
