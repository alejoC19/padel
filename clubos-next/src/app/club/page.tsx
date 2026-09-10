'use client';

import { AppShell } from '@/components/AppShell';
import { ClubSettingsScreen } from '@/components/ClubSettingsScreen';
import { RouteGuard } from '@/components/RouteGuard';

export default function ClubRoute() {
  return (
    <AppShell>
      <RouteGuard requiredPermission="club.settings">
        <ClubSettingsScreen />
      </RouteGuard>
    </AppShell>
  );
}
