'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { readSession, useSession, type Session } from '@/hooks';
import { BrandMark } from '@/components/BrandMark';

/**
 * Marco de las pantallas internas.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ SIDEBAR AGRUPADA, NO UNA FILA DE 11 LINKS
 * ---------------------------------------------------------------------------
 * La topbar horizontal anterior le daba el mismo peso visual a Agenda (lo
 * que recepción mira 8 horas) que a "Club" (lo que se toca una vez al dar de
 * alta el club). Agrupar por frecuencia real de uso —Operación, Negocio,
 * Administración— es lo que hace que la navegación transmita jerarquía en
 * vez de ser una lista de features.
 *
 * ---------------------------------------------------------------------------
 * MOBILE NO ES EL SIDEBAR COMPRIMIDO
 * ---------------------------------------------------------------------------
 * En un celular, recepción usa Agenda, Caja y Clientes — el resto es
 * ocasional. Por eso mobile tiene su propia barra de 4 destinos (los 3 de
 * uso diario + "Más"), no la sidebar de escritorio metida en un drawer.
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

interface NavGroup {
  label: string;
  items: NavItem[];
}

const ICONS = {
  agenda: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18M8 2v4M16 2v4" />
    </>
  ),
  caja: (
    <>
      <rect x="2" y="6" width="20" height="13" rx="2" />
      <path d="M2 11h20M6 15h4" />
    </>
  ),
  canchas: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M12 4v16M3 12h18" />
    </>
  ),
  buffet: (
    <>
      <path d="M6 2h12l-1 8H7L6 2z" />
      <path d="M7 10v11a1 1 0 001 1h8a1 1 0 001-1V10" />
    </>
  ),
  productos: (
    <>
      <path d="M21 8l-9-5-9 5 9 5 9-5z" />
      <path d="M3 8v8l9 5 9-5V8M12 13v8" />
    </>
  ),
  clientes: (
    <>
      <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 00-3-3.87" />
    </>
  ),
  torneos: (
    <>
      <path d="M6 9H4.5a2.5 2.5 0 010-5H6M18 9h1.5a2.5 2.5 0 000-5H18" />
      <path d="M6 4h12v5a6 6 0 01-12 0V4zM12 15v4M8 22h8" />
    </>
  ),
  tesoreria: (
    <>
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2M12 12v4M10 14h4" />
    </>
  ),
  reportes: (
    <>
      <path d="M3 3v18h18" />
      <path d="M7 15l4-5 4 3 5-7" />
    </>
  ),
  equipo: (
    <>
      <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
    </>
  ),
  club: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a15 15 0 000 18M12 3a15 15 0 010 18M3 12h18" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </>
  ),
};

const GROUPS: NavGroup[] = [
  {
    label: 'Operación',
    items: [
      { href: '/agenda', label: 'Agenda', permission: 'booking.view', icon: ICONS.agenda },
      { href: '/caja', label: 'Caja', permission: 'cash.view', icon: ICONS.caja },
      { href: '/canchas', label: 'Canchas', permission: 'court.view', icon: ICONS.canchas },
    ],
  },
  {
    label: 'Negocio',
    items: [
      { href: '/clientes', label: 'Clientes', permission: 'client.view', icon: ICONS.clientes },
      { href: '/buffet', label: 'Buffet', permission: 'sale.create', icon: ICONS.buffet },
      { href: '/productos', label: 'Productos', permission: 'product.manage', icon: ICONS.productos },
      { href: '/torneos', label: 'Torneos', permission: 'tournament.view', icon: ICONS.torneos },
    ],
  },
  {
    label: 'Administración',
    items: [
      { href: '/tesoreria', label: 'Tesorería', permission: 'treasury.view', icon: ICONS.tesoreria },
      { href: '/reportes', label: 'Reportes', permission: 'report.financial', icon: ICONS.reportes },
      { href: '/equipo', label: 'Equipo', permission: 'user.view', icon: ICONS.equipo },
      { href: '/club', label: 'Club', permission: 'club.settings', icon: ICONS.club },
    ],
  },
];

/** Los 3 destinos que recepción realmente toca desde el celular. El resto
 *  vive en la hoja de "Más" (ver MoreSheet más abajo). */
const MOBILE_PRIMARY = ['/agenda', '/caja', '/clientes'];

function NavIcon({ children, size = 15 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" aria-hidden="true">
      {children}
    </svg>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, can, logout } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // La sesión se lee después de montar; hasta entonces no se sabe si hay
  // backend, y mostrar la navegación filtrada con datos incompletos haría
  // parpadear los links.
  const [ready, setReady] = useState(false);

  useEffect(() => { setReady(true); }, []);

  // Cerrar la hoja mobile al cambiar de ruta.
  useEffect(() => { setMoreOpen(false); }, [pathname]);

  // Cerrar hoja/menú con la tecla Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setMoreOpen(false); setMenuOpen(false); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const demo = ready && session === null;
  const visibleGroups = GROUPS
    .map((g) => ({ ...g, items: g.items.filter((n) => !n.permission || demo || can(n.permission)) }))
    .filter((g) => g.items.length > 0);
  const allVisible = visibleGroups.flatMap((g) => g.items);
  const primaryItems = MOBILE_PRIMARY
    .map((href) => allVisible.find((n) => n.href === href))
    .filter((n): n is NavItem => Boolean(n));
  const secondaryItems = allVisible.filter((n) => !MOBILE_PRIMARY.includes(n.href));

  return (
    <div className="shell">
      <aside className="shell-sidebar">
        <Link href="/agenda" className="brand">
          <BrandMark size={28} />
          ClubOS
          {session?.clubName && <span className="brand-club">{session.clubName}</span>}
        </Link>

        <nav className="sidebar-nav" aria-label="Secciones">
          {visibleGroups.map((group) => (
            <div key={group.label}>
              <div className="nav-group-label">{group.label}</div>
              <div className="nav-group-links">
                {group.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`nav-link${pathname.startsWith(item.href) ? ' is-active' : ''}`}
                  >
                    <NavIcon>{item.icon}</NavIcon>
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      <div className="shell-main">
        <header className="topbar">
          <Link href="/agenda" className="brand topbar-brand-mobile">
            <BrandMark size={26} />
            ClubOS
          </Link>

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
                  onClick={() => { void logout().then(() => router.push('/entrar')); }}
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

        <main className="shell-body">{children}</main>
      </div>

      {/* Barra inferior mobile: los 3 destinos de uso diario + "Más". */}
      <nav className="bottom-nav" aria-label="Secciones">
        <div className="bottom-nav-row">
          {primaryItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`bottom-nav-link${pathname.startsWith(item.href) ? ' is-active' : ''}`}
            >
              <NavIcon size={20}>{item.icon}</NavIcon>
              {item.label}
            </Link>
          ))}
          <button
            className="bottom-nav-more"
            onClick={() => setMoreOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
          >
            <NavIcon size={20}>{ICONS.more}</NavIcon>
            Más
          </button>
        </div>
      </nav>

      {moreOpen && (
        <>
          <div className="more-sheet-backdrop" onClick={() => setMoreOpen(false)} />
          <div className="more-sheet" role="dialog" aria-modal="true" aria-label="Más secciones">
            <div className="more-sheet-head">
              <span className="more-sheet-title">Más</span>
              <button
                className="more-sheet-close"
                onClick={() => setMoreOpen(false)}
                aria-label="Cerrar"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="more-sheet-links">
              {secondaryItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`more-sheet-link${pathname.startsWith(item.href) ? ' is-active' : ''}`}
                  onClick={() => setMoreOpen(false)}
                >
                  <NavIcon size={18}>{item.icon}</NavIcon>
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Lee la sesión una vez, sin re-render. Para código fuera de componentes. */
export function currentSession(): Session | null {
  return readSession();
}
