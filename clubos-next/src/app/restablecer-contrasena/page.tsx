'use client';

import { Suspense } from 'react';
import { ResetPasswordScreen } from '@/components/ResetPasswordScreen';

/**
 * `/restablecer-contrasena?token=...` — el token viaja en el query string
 * (leído con useSearchParams dentro de ResetPasswordScreen). Next exige un
 * <Suspense> alrededor de cualquier uso de useSearchParams.
 */
export default function RestablecerContrasenaRoute() {
  return (
    <Suspense fallback={<main className="auth-card" />}>
      <ResetPasswordScreen />
    </Suspense>
  );
}
