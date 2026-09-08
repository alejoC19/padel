'use client';

import { AppShell } from '@/components/AppShell';
import { CourtsScreen } from '@/components/CourtsScreen';
import { RouteGuard } from '@/components/RouteGuard';

export default function CanchasRoute() {
  return (
    <AppShell>
      <RouteGuard requiredPermission="court.view">
        <CourtsScreen />
      </RouteGuard>
    </AppShell>
  );
}
