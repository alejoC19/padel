'use client';

import Link from 'next/link';
import { useSession } from '@/hooks';

/**
 * Segunda barrera de acceso, a nivel de página.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ NO ALCANZA CON OCULTAR EL LINK
 * ---------------------------------------------------------------------------
 * AppShell ya filtra qué links de navegación se muestran según el permiso
 * del usuario, pero eso solo protege a quien navega haciendo clic. Escribir
 * la URL a mano, entrar por un favorito o recargar la pestaña no pasa por
 * ningún link — y ahí no hay nada que lo frene.
 *
 * Este componente es esa segunda capa: se coloca alrededor de cada pantalla
 * protegida y decide, antes de que la pantalla dispare ningún pedido al
 * backend, si corresponde mostrarla. El backend igual va a rechazar la
 * llamada (eso ya está bien resuelto ahí), pero para cuando esa respuesta
 * vuelve, la pantalla ya mostró datos reales o cayó en el cartel genérico de
 * "esto necesita el backend" — indistinguible de una caída del servidor.
 * Bloquear antes es la diferencia entre un error de permisos legible y una
 * fuga de datos que nadie nota.
 * ---------------------------------------------------------------------------
 * MODO DEMOSTRACIÓN
 * ---------------------------------------------------------------------------
 * Sin sesión (visitante sin login) se deja pasar a propósito: es la
 * vidriera de venta del producto y tiene que poder recorrerse entera sin
 * backend, permiso por permiso.
 * ---------------------------------------------------------------------------
 */

/** Permiso mínimo por sección, y a dónde mandar a alguien que no lo tiene. */
const FALLBACK_ROUTES: Array<{ href: string; permission: string }> = [
  { href: '/agenda', permission: 'booking.view' },
  { href: '/caja', permission: 'cash.view' },
  { href: '/clientes', permission: 'client.view' },
  { href: '/buffet', permission: 'sale.create' },
  { href: '/torneos', permission: 'tournament.view' },
  { href: '/tesoreria', permission: 'treasury.view' },
  { href: '/reportes', permission: 'report.financial' },
];

interface RouteGuardProps {
  /** Permiso que el backend exige para el endpoint principal de esta pantalla. */
  requiredPermission: string;
  children: React.ReactNode;
}

export function RouteGuard({ requiredPermission, children }: RouteGuardProps) {
  const { ready, isDemo, can } = useSession();

  // La sesión se lee después de montar (ver useSession). Hasta entonces no
  // se sabe si hay sesión ni qué permisos tiene: mostrar la pantalla real o
  // el cartel de "sin permiso" en ese momento sería adivinar.
  if (!ready) {
    return <div className="app-loading">Cargando…</div>;
  }

  if (!isDemo && !can(requiredPermission)) {
    return <Forbidden />;
  }

  return <>{children}</>;
}

function Forbidden() {
  const { can } = useSession();
  const back = FALLBACK_ROUTES.find((r) => can(r.permission));

  return (
    <div className="forbidden-screen" role="alert">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v1M12 12v4" />
      </svg>
      <h1>No tenés permiso para ver esto</h1>
      <p>
        Tu usuario no tiene el permiso necesario para acceder a esta sección.
        Si te parece que es un error, pedile a un administrador del club que
        revise tu rol.
      </p>
      <Link href={back?.href ?? '/'} className="btn btn-secondary">
        {back ? 'Volver a lo que sí puedo ver' : 'Ir al inicio'}
      </Link>
    </div>
  );
}
