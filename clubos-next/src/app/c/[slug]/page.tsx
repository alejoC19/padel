'use client';

import { useParams } from 'next/navigation';
import { PlayerBookingScreen } from '@/components/player/PlayerBookingScreen';

/**
 * `/c/[slug]` — landing pública del club: disponibilidad + reserva.
 * Es cliente porque todo depende de datos que solo existen en el navegador
 * (fecha elegida, horario elegido) y de llamadas a la API pública en vivo.
 */
export default function ClubBookingRoute() {
  const params = useParams<{ slug: string }>();
  return <PlayerBookingScreen slug={params.slug} />;
}
