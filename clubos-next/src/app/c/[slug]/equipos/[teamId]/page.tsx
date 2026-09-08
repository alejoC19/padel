'use client';

import { Suspense } from 'react';
import { useParams } from 'next/navigation';
import { TeamReceiptScreen } from '@/components/player/TeamReceiptScreen';

function EquipoDetalleInner() {
  const params = useParams<{ slug: string; teamId: string }>();
  return <TeamReceiptScreen slug={params.slug} teamId={params.teamId} />;
}

/**
 * `/c/[slug]/equipos/[teamId]?token=...` — comprobante de una inscripción.
 * Mismo motivo que reservas/[id]: el token viaja en el query string, así que
 * necesita <Suspense> alrededor de useSearchParams.
 */
export default function EquipoDetalleRoute() {
  return (
    <Suspense fallback={<div className="player-state"><div className="spinner" /></div>}>
      <EquipoDetalleInner />
    </Suspense>
  );
}
