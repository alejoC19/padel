'use client';

import { useParams } from 'next/navigation';
import { MyBookingsScreen } from '@/components/player/MyBookingsScreen';
import { PlayerAuthGate } from '@/components/player/PlayerAuthGate';

export default function MisReservasRoute() {
  const params = useParams<{ slug: string }>();
  return (
    <PlayerAuthGate>
      <MyBookingsScreen slug={params.slug} />
    </PlayerAuthGate>
  );
}
