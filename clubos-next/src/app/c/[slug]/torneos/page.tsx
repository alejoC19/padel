'use client';

import { useParams } from 'next/navigation';
import { PlayerTournamentsScreen } from '@/components/player/PlayerTournamentsScreen';

/** `/c/[slug]/torneos` — torneos con inscripción abierta o próximos a jugarse. */
export default function TorneosRoute() {
  const params = useParams<{ slug: string }>();
  return <PlayerTournamentsScreen slug={params.slug} />;
}
