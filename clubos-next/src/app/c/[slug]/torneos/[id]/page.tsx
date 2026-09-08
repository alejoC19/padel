'use client';

import { useParams } from 'next/navigation';
import { PlayerTournamentDetailScreen } from '@/components/player/PlayerTournamentDetailScreen';

/** `/c/[slug]/torneos/[id]` — detalle de un torneo + inscripción de equipo. */
export default function TorneoDetalleRoute() {
  const params = useParams<{ slug: string; id: string }>();
  return <PlayerTournamentDetailScreen slug={params.slug} id={params.id} />;
}
