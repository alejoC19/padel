'use client';

import { AppShell } from '@/components/AppShell';
import { CashScreen } from '@/components/CashScreen';
import { RouteGuard } from '@/components/RouteGuard';

export default function CajaRoute() {
  return (
    <AppShell>
      <RouteGuard requiredPermission="cash.view">
        <CashScreen />
      </RouteGuard>
    </AppShell>
  );
}
