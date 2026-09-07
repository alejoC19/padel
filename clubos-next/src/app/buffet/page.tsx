'use client';

import { AppShell } from '@/components/AppShell';
import { PosScreen } from '@/components/PosScreen';
import { RouteGuard } from '@/components/RouteGuard';

export default function BuffetRoute() {
  return (
    <AppShell>
      <RouteGuard requiredPermission="sale.create">
        <PosScreen />
      </RouteGuard>
    </AppShell>
  );
}
