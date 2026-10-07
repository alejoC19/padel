'use client';

import { Suspense, type ReactNode } from 'react';
import { usePlayerAccount } from '@/lib/playerAuth';
import { PlayerAccountScreen } from './PlayerAccountScreen';

/**
 * Para entrar como jugador (reservar, ver "mis reservas") hace falta una
 * cuenta — se pide UNA sola vez por dispositivo: `playerAuth.ts` persiste
 * la cuenta en localStorage y la sesión en una cookie httpOnly, así que
 * una vez logueado esto deja de pedirse hasta que cierre sesión.
 *
 * Deliberadamente NO se usa en TODO el portal: el comprobante por token
 * (`/c/[slug]/reservas/[id]`, `/equipos/[teamId]`) tiene que seguir siendo
 * accesible sin cuenta — es el link que se manda por mail, y exigir login
 * ahí le rompería el acceso a su propio comprobante a cualquiera que
 * reservó antes de que existieran las cuentas.
 */
export function PlayerAuthGate({ children }: { children: ReactNode }) {
  const account = usePlayerAccount();
  if (!account) {
    // PlayerAccountScreen usa useSearchParams (lee `?next=`) — Next exige
    // un <Suspense> alrededor de cualquier uso de eso, o falla el
    // prerender estático de toda página que este gate envuelva.
    return (
      <Suspense fallback={<main className="player-state" />}>
        <PlayerAccountScreen onSuccess={() => {}} />
      </Suspense>
    );
  }
  return <>{children}</>;
}
