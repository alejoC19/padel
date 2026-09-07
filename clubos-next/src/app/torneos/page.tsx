'use client';

import { AppShell } from '@/components/AppShell';
import { TournamentsScreen } from '@/components/TournamentsScreen';
import { RouteGuard } from '@/components/RouteGuard';

export default function TorneosRoute() {
  return (
    <AppShell>
      <RouteGuard requiredPermission="tournament.view">
        <TournamentsScreen />
      </RouteGuard>
    </AppShell>
  );
}
