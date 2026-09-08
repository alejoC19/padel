'use client';

import { useParams } from 'next/navigation';
import { PlayerBuffetScreen } from '@/components/player/PlayerBuffetScreen';

/** `/c/[slug]/buffet` — carta del buffet, solo lectura. */
export default function BuffetRoute() {
  const params = useParams<{ slug: string }>();
  return <PlayerBuffetScreen slug={params.slug} />;
}
