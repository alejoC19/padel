'use client';

import { useCallback, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError } from '@/lib/api';
import { playerAuth, usePlayerAccount } from '@/lib/playerAuth';

type Mode = 'login' | 'register';

/**
 * Login/registro de la cuenta del jugador (/jugador/cuenta).
 *
 * Es la MISMA cuenta de plataforma que usa el panel de staff (ver el
 * comentario grande en playerAuth.ts) — acá solo se le da una cara pensada
 * para un jugador: sin selector de club, sin nada de permisos.
 *
 * Al loguearse, `reservar()` (PlayerBookingScreen) empieza a mandar el
 * access token y el backend vincula el Client de cada club a esta cuenta
 * (`userId`) — así "mis reservas" deja de depender de tipear el teléfono
 * cada vez, y reservar con un teléfono nuevo nunca más choca con el email
 * ya cargado (ver PR de `clients_email_uq`).
 */
export function PlayerAccountScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const account = usePlayerAccount();
  const next = params.get('next') || '/jugador';

  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const friendlyError = useCallback((e: unknown, fallback: string): string => {
    if (e instanceof ApiError) return e.message;
    return fallback;
  }, []);

  const submit = useCallback(async () => {
    setError(null);
    if (!email.trim() || !password.trim()) {
      setError('Completá tu email y contraseña.');
      return;
    }
    if (mode === 'register' && (!firstName.trim() || !lastName.trim() || !phone.trim())) {
      setError('Completá nombre, apellido y teléfono.');
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'login') {
        await playerAuth.login({ email: email.trim(), password });
      } else {
        await playerAuth.register({
          email: email.trim(),
          password,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: phone.trim(),
        });
      }
      router.push(next);
    } catch (e) {
      setError(friendlyError(
        e,
        mode === 'login'
          ? 'No pudimos iniciar tu sesión. Probá de nuevo en un momento.'
          : 'No pudimos crear tu cuenta. Probá de nuevo en un momento.',
      ));
    } finally {
      setSubmitting(false);
    }
  }, [mode, email, password, firstName, lastName, phone, next, router, friendlyError]);

  const logout = useCallback(async () => {
    setSubmitting(true);
    try {
      await playerAuth.logout();
    } finally {
      setSubmitting(false);
    }
  }, []);

  if (account) {
    return (
      <>
        <header className="player-header">
          <div className="player-eyebrow">ClubOS</div>
          <h1 className="player-club-name">Tu cuenta</h1>
          <p className="player-tagline">Así vas a quedar identificado en cualquier club donde reserves.</p>
        </header>

        <section>
          <div className="player-section-title">Datos</div>
          <div className="field">
            <label className="label">Nombre</label>
            <p className="field-hint" style={{ marginTop: 0 }}>{account.firstName} {account.lastName}</p>
          </div>
          <div className="field">
            <label className="label">Email</label>
            <p className="field-hint" style={{ marginTop: 0 }}>{account.email}</p>
          </div>
          {account.phone && (
            <div className="field">
              <label className="label">Teléfono</label>
              <p className="field-hint" style={{ marginTop: 0 }}>{account.phone}</p>
            </div>
          )}
        </section>

        <button className="btn btn-secondary" disabled={submitting} onClick={() => void logout()}>
          {submitting ? <span className="spinner" /> : 'Cerrar sesión'}
        </button>
      </>
    );
  }

  return (
    <>
      <header className="player-header">
        <div className="player-eyebrow">ClubOS</div>
        <h1 className="player-club-name">{mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}</h1>
        <p className="player-tagline">
          Guardá tus datos una vez y reservá más rápido en cualquier club de ClubOS.
        </p>
      </header>

      <section>
        <div className="duration-seg">
          <button type="button" className={mode === 'login' ? 'is-active' : ''} onClick={() => { setMode('login'); setError(null); }}>
            Ya tengo cuenta
          </button>
          <button type="button" className={mode === 'register' ? 'is-active' : ''} onClick={() => { setMode('register'); setError(null); }}>
            Crear cuenta
          </button>
        </div>
      </section>

      <section className="booking-form" style={{ marginTop: 4 }}>
        {mode === 'register' && (
          <>
            <div className="field">
              <label className="label" htmlFor="pa-firstname">Nombre</label>
              <input
                id="pa-firstname" className="input" value={firstName} disabled={submitting}
                onChange={(e) => setFirstName(e.target.value)} placeholder="Tu nombre"
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="pa-lastname">Apellido</label>
              <input
                id="pa-lastname" className="input" value={lastName} disabled={submitting}
                onChange={(e) => setLastName(e.target.value)} placeholder="Tu apellido"
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="pa-phone">Teléfono</label>
              <input
                id="pa-phone" className="input" type="tel" inputMode="tel" value={phone} disabled={submitting}
                onChange={(e) => setPhone(e.target.value)} placeholder="+54 9 11 5555 5555"
              />
            </div>
          </>
        )}
        <div className="field">
          <label className="label" htmlFor="pa-email">Email</label>
          <input
            id="pa-email" className="input" type="email" value={email} disabled={submitting}
            onChange={(e) => { setEmail(e.target.value); setError(null); }} placeholder="tu@email.com"
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="pa-password">Contraseña</label>
          <input
            id="pa-password" className="input" type="password" value={password} disabled={submitting}
            onChange={(e) => { setPassword(e.target.value); setError(null); }}
            placeholder={mode === 'register' ? 'Mínimo 10 caracteres, con letras y números' : 'Tu contraseña'}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          />
        </div>

        {error && <div className="alert player-form-alert">{error}</div>}

        <button className="btn btn-primary" disabled={submitting} onClick={() => void submit()}>
          {submitting ? <span className="spinner" /> : (mode === 'login' ? 'Entrar' : 'Crear cuenta')}
        </button>
      </section>
    </>
  );
}
