'use client';

import { AppShell } from '@/components/AppShell';
import { AgendaScreen } from '@/components/AgendaScreen';
import { RouteGuard } from '@/components/RouteGuard';

/**
 * Agenda.
 *
 * Es cliente y no server component porque todo acá es interacción —
 * arrastrar bloques, atajos de teclado, refresco automático — y el contenido
 * depende de una sesión que vive en el navegador.
 */
export default function AgendaRoute() {
  return (
    <AppShell>
      <RouteGuard requiredPermission="booking.view">
        <AgendaScreen />
      </RouteGuard>
    </AppShell>
  );
}
