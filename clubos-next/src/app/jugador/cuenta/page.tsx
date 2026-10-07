'use client';

import { Suspense } from 'react';
import { PlayerAccountScreen } from '@/components/player/PlayerAccountScreen';

/**
 * `/jugador/cuenta` — login/registro del jugador. `?next=` (leído con
 * useSearchParams dentro de PlayerAccountScreen) dice a dónde volver tras
 * loguearse; Next exige un <Suspense> alrededor de cualquier uso de eso.
 */
export default function JugadorCuentaRoute() {
  return (
    <Suspense fallback={<main className="player-state" />}>
      <PlayerAccountScreen />
    </Suspense>
  );
}
