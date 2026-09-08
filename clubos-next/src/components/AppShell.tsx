'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { readSession, useSession, type Session } from '@/hooks';

/**
 * Marco de las pantallas internas.
 *
 * ---------------------------------------------------------------------------
 * LA NAVEGACIÓN SE FILTRA POR PERMISO
 * ---------------------------------------------------------------------------
 * Recepción no ve "Reportes" ni "Tesorería". No es solo estética: mostrar un
 * link que lleva a un 403 enseña al operador a ignorar los mensajes de error,
 * y después ignora los que importan.
 *
 * En modo demostración (sin sesión) se muestra todo, para poder recorrer el
 * producto sin backend.
 * ---------------------------------------------------------------------------
 */

interface NavItem {
  href: string;
  label: string;
  permission: string | null;
  icon: React.ReactNode;
}

const NAV: NavItem[] = [
  {
    href: '/agenda',
    label: 'Agenda',
    permission: 'booking.view',
    icon: (
      <>
        <rect x="3" y="4" width="18" height="17" rx="2" />
        <path d="M3 9h18M8 2v4M16 2v4" />
      </>
    ),
  },
  {
    href: '/caja',
    label: 'Caja',
    permission: 'cash.view',
    icon: (
      <>
        <rect x="2" y="6" width="20" height="13" rx="2" />
        <path d="M2 11h20M6 15h4" />
      </>
    ),
  },
  {
    href: '/canchas',
    label: 'Canchas',
    permission: 'court.view',
    icon: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M12 4v16M3 12h18" />
      </>
    ),
  },
  {
    href: '/buffet',
    label: 'Buffet',
    permission: 'sale.create',
    icon: (
      <>
        <path d="M6 2h12l-1 8H7L6 2z" />
        <path d="M7 10v11a1 1 0 001 1h8a1 1 0 001-1V10" />
      </>
    ),
  },
  {
    href: '/clientes',
    label: 'Clientes',
    permission: 'client.view',
    icon: (
      <>
        <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 00-3-3.87" />
      </>
    ),
  },
  {
    href: '/torneos',
    label: 'Torneos',
    permission: 'tournament.view',
    icon: (
      <>
        <path d="M6 9H4.5a2.5 2.5 0 010-5H6M18 9h1.5a2.5 2.5 0 000-5H18" />
        <path d="M6 4h12v5a6 6 0 01-12 0V4zM12 15v4M8 22h8" />
      </>
    ),
  },
  {
    href: '/tesoreria',
    label: 'Tesorería',
    permission: 'treasury.view',
    icon: (
      <>
        <rect x="2" y="7" width="20" height="14" rx="2" />
        <path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2M12 12v4M10 14h4" />
      </>
    ),
  },
  {
    href: '/reportes',
    label: 'Reportes',
    permission: 'report.financial',
    icon: (
      <>
        <path d="M3 3v18h18" />
        <path d="M7 15l4-5 4 3 5-7" />
      </>
    ),
  },
  {
    href: '/equipo',
    label: 'Equipo',
    permission: 'user.view',
    icon: (
      <>
        <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
      </>
    ),
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, can, logout } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  // La sesión se lee después de montar; hasta entonces no se sabe si hay
  // backend, y mostrar la navegación filtrada con datos incompletos haría
  // parpadear los links.
  const [ready, setReady] = useState(false);

  useEffect(() => { setReady(true); }, []);

  // Cerrar el drawer mobile al cambiar de ruta.
  useEffect(() => { setNavOpen(false); }, [pathname]);

  // Cerrar drawer/menú con la tecla Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setNavOpen(false); setMenuOpen(false); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const demo = ready && session === null;
  const visible = NAV.filter((n) => !n.permission || can(n.permission));

  return (
    <div className="shell">
      <header className="topbar">
        <button
          className="nav-burger"
          onClick={() => setNavOpen(true)}
          aria-label="Abrir menú de navegación"
          aria-expanded={navOpen}
          aria-controls="mobile-nav"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M3 12h18M3 6h18M3 18h18" />
          </svg>
        </button>

        <Link href="/agenda" className="brand">
          <span className="brand-mark" aria-hidden="true">C</span>
          ClubOS
          <span className="brand-club">{session?.clubName ?? 'Club Demo Pádel'}</span>
        </Link>

        <nav className="main-nav" aria-label="Secciones">
          {visible.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-link${pathname.startsWith(item.href) ? ' is-active' : ''}`}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="2" aria-hidden="true">
                {item.icon}
              </svg>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="topbar-spacer" />

        {demo && (
          <span className="demo-badge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              <circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" />
            </svg>
            Datos de ejemplo
          </span>
        )}

        <div className="user-menu">
          <button
            className="user-btn"
            onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            {session
              ? session.userName.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
              : '—'}
          </button>
          {menuOpen && (
            <div className="user-pop" role="menu">
              <div className="user-info">
                <div className="user-name">{session?.userName ?? 'Modo demostración'}</div>
                <div className="user-club">{session?.clubName ?? 'Sin conexión'}</div>
              </div>
              <button
                className="user-action"
                onClick={() => { logout(); router.push('/entrar'); }}
                role="menuitem"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
                </svg>
                Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Drawer de navegación para móvil */}
      {navOpen && (
        <>
          <div className="nav-drawer-backdrop" onClick={() => setNavOpen(false)} />
          <nav id="mobile-nav" className="nav-drawer" aria-label="Navegación">
            <div className="nav-drawer-head">
              <span className="brand">
                <span className="brand-mark" aria-hidden="true">C</span>
                ClubOS
              </span>
              <button
                className="nav-drawer-close"
                onClick={() => setNavOpen(false)}
                aria-label="Cerrar menú"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="nav-drawer-links">
              {visible.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`nav-drawer-link${pathname.startsWith(item.href) ? ' is-active' : ''}`}
                  onClick={() => setNavOpen(false)}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                       stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    {item.icon}
                  </svg>
                  {item.label}
                </Link>
              ))}
            </div>
          </nav>
        </>
      )}

      <main className="shell-body">{children}</main>
    </div>
  );
}

/** Lee la sesión una vez, sin re-render. Para código fuera de componentes. */
export function currentSession(): Session | null {
  return readSession();
}
