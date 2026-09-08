'use client';

import { AppShell } from '@/components/AppShell';
import { TeamScreen } from '@/components/TeamScreen';
import { RouteGuard } from '@/components/RouteGuard';

export default function EquipoRoute() {
  return (
    <AppShell>
      <RouteGuard requiredPermission="user.view">
        <TeamScreen />
      </RouteGuard>
    </AppShell>
  );
}
