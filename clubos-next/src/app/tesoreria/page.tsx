'use client';

import { AppShell } from '@/components/AppShell';
import { TreasuryScreen } from '@/components/TreasuryScreen';
import { RouteGuard } from '@/components/RouteGuard';

export default function TesoreriaRoute() {
  return (
    <AppShell>
      <RouteGuard requiredPermission="treasury.view">
        <TreasuryScreen />
      </RouteGuard>
    </AppShell>
  );
}
