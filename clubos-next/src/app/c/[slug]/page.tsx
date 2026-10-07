'use client';

import { useParams } from 'next/navigation';
import { PlayerBookingScreen } from '@/components/player/PlayerBookingScreen';
import { PlayerAuthGate } from '@/components/player/PlayerAuthGate';

/**
 * `/c/[slug]` — landing pública del club: disponibilidad + reserva.
 * Es cliente porque todo depende de datos que solo existen en el navegador
 * (fecha elegida, horario elegido) y de llamadas a la API pública en vivo.
 *
 * Gateada con `PlayerAuthGate`: reservar exige cuenta (ver reservar() en
 * public.service.ts, ya no acepta invitado). El resto de `/c/[slug]/*`
 * (comprobante por token, torneos, buffet) NO pasa por acá — cada ruta
 * decide esto por su cuenta, a propósito.
 */
export default function ClubBookingRoute() {
  const params = useParams<{ slug: string }>();
  return (
    <PlayerAuthGate>
      <PlayerBookingScreen slug={params.slug} />
    </PlayerAuthGate>
  );
}
