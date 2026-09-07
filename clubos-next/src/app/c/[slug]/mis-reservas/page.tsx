'use client';

import { useParams } from 'next/navigation';
import { MyBookingsScreen } from '@/components/player/MyBookingsScreen';

export default function MisReservasRoute() {
  const params = useParams<{ slug: string }>();
  return <MyBookingsScreen slug={params.slug} />;
}
