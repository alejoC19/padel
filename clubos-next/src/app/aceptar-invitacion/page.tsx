'use client';

import { Suspense } from 'react';
import { AcceptInviteScreen } from '@/components/AcceptInviteScreen';

/**
 * `/aceptar-invitacion?token=...` — mismo motivo de <Suspense> que
 * `/restablecer-contrasena` (useSearchParams dentro del componente).
 */
export default function AceptarInvitacionRoute() {
  return (
    <Suspense fallback={<main className="auth-card" />}>
      <AcceptInviteScreen />
    </Suspense>
  );
}
