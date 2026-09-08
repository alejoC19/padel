'use client';

import { useCallback, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Ball, PadelDefs } from '@/components/marketing/Art';
import { api, ApiError } from '@/lib/api';

/** Consume el link de "olvidé mi contraseña" y fija la nueva. */
export function ResetPasswordScreen() {
  const router = useRouter();
  const token = useSearchParams().get('token');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = useCallback(async () => {
    if (!token) return;
    if (password.length < 10 || !/(?=.*[a-zA-Z])(?=.*\d)/.test(password)) {
      setError('La contraseña debe tener al menos 10 caracteres, con una letra y un número.');
      return;
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.auth.resetPassword(token, password);
      setDone(true);
      setTimeout(() => router.push('/entrar'), 2000);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No pudimos restablecer la contraseña.');
    } finally {
      setLoading(false);
    }
  }, [token, password, confirm, router]);

  if (!token) {
    return (
      <main className="auth-card">
        <PadelDefs />
        <h1 className="auth-h1">Link inválido</h1>
        <p className="auth-sub">Este link no tiene el token necesario.</p>
        <Link href="/olvide-password" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
          Pedir un link nuevo
        </Link>
      </main>
    );
  }

  if (done) {
    return (
      <main className="auth-card">
        <PadelDefs />
        <h1 className="auth-h1">Listo</h1>
        <p className="auth-sub">Tu contraseña se actualizó. Te llevamos a entrar…</p>
      </main>
    );
  }

  return (
    <main className="auth-card">
      <PadelDefs />
      <div className="auth-brand">
        <Ball size={26} />
        <span className="auth-brand-name">ClubOS</span>
      </div>
      <h1 className="auth-h1">Elegí una nueva contraseña</h1>

      {error && (
        <div className="alert" role="alert">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
            <circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" />
          </svg>
          <div>{error}</div>
        </div>
      )}

      <div className="field">
        <label className="label" htmlFor="password">Contraseña nueva</label>
        <input
          id="password" className="input" type="password" autoFocus
          autoComplete="new-password" value={password} disabled={loading}
          onChange={(e) => { setPassword(e.target.value); setError(null); }}
        />
      </div>

      <div className="field">
        <label className="label" htmlFor="confirm">Repetila</label>
        <input
          id="confirm" className="input" type="password"
          autoComplete="new-password" value={confirm} disabled={loading}
          onChange={(e) => { setConfirm(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
        />
      </div>

      <button className="btn btn-primary" disabled={loading} onClick={() => void submit()}>
        {loading ? <><span className="spinner" aria-hidden="true" /> Guardando…</> : 'Guardar contraseña'}
      </button>
    </main>
  );
}
