'use client';

import { Suspense } from 'react';
import { useParams } from 'next/navigation';
import { BookingReceiptScreen } from '@/components/player/BookingReceiptScreen';

function ReservaDetalleInner() {
  const params = useParams<{ slug: string; id: string }>();
  return <BookingReceiptScreen slug={params.slug} id={params.id} />;
}

/**
 * `/c/[slug]/reservas/[id]?token=...` — comprobante de una reserva.
 * El token viaja en el query string (leído con useSearchParams dentro de
 * BookingReceiptScreen) para que el link entero sea bookmarkeable/compartible.
 * Next exige un <Suspense> alrededor de cualquier uso de useSearchParams
 * para poder generar la ruta sin forzar todo el árbol a client-side-only.
 */
export default function ReservaDetalleRoute() {
  return (
    <Suspense fallback={<div className="player-state"><div className="spinner" /></div>}>
      <ReservaDetalleInner />
    </Suspense>
  );
}
