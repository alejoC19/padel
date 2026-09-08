'use client';

import { usePathname } from 'next/navigation';

/**
 * Navegación inferior de la app UNIFICADA (/jugador) — a diferencia de
 * PlayerTabBar (que vive en /c/[slug] y tiene 3 secciones de UN club), acá
 * solo hay dos: encontrar un club, y ver las reservas propias en
 * cualquiera de ellos. Mismas clases CSS que PlayerTabBar (.player-tabbar,
 * .player-tab): son genéricas, no dependen del slug.
 */
export function JugadorTabBar() {
  const pathname = usePathname();

  const tabs = [
    { href: '/jugador', label: 'Buscar club', match: (p: string) => p === '/jugador', icon: <SearchIcon /> },
    { href: '/jugador/mis-reservas', label: 'Mis reservas', match: (p: string) => p.startsWith('/jugador/mis-reservas'), icon: <TicketIcon /> },
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

function SearchIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

function TicketIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8Z" />
      <path d="M12 6v2M12 11v2M12 16v2" />
    </svg>
  );
}
