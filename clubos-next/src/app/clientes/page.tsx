'use client';

import { AppShell } from '@/components/AppShell';
import { ClientsScreen } from '@/components/ClientsScreen';

export default function ClientesRoute() {
  return (
    <AppShell>
      <ClientsScreen />
    </AppShell>
  );
}
