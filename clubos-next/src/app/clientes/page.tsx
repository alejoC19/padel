'use client';

import { AppShell } from '@/components/AppShell';
import { ClientsScreen } from '@/components/ClientsScreen';
import { RouteGuard } from '@/components/RouteGuard';

export default function ClientesRoute() {
  return (
    <AppShell>
      <RouteGuard requiredPermission="client.view">
        <ClientsScreen />
      </RouteGuard>
    </AppShell>
  );
}
