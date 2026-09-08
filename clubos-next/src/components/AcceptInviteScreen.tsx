'use client';

import { useCallback, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Ball, PadelDefs } from '@/components/marketing/Art';
import { api, setSession, ApiError } from '@/lib/api';

/**
 * Acepta una invitación de staff: fija la contraseña y entra directo, sin
 * pedir un login de más — la persona ya probó tener acceso al email al
 * llegar acá con el link.
 */
export function AcceptInviteScreen() {
  const router = useRouter();
  const token = useSearchParams().get('token');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const res = await api.auth.acceptInvite(token, password);
      if (!res.activeClub) {
        setError('Tu cuenta no quedó asociada a ningún club. Contactá al club que te invitó.');
        return;
      }
      sessionStorage.setItem('clubos.token', res.accessToken);
      sessionStorage.setItem('clubos.club', res.activeClub.id);
      sessionStorage.setItem('clubos.clubName', res.activeClub.name);
      sessionStorage.setItem('clubos.user', `${res.user.firstName} ${res.user.lastName}`);
      sessionStorage.setItem('clubos.permissions', JSON.stringify(res.permissions));
      setSession(res.accessToken, res.activeClub.id);
      router.push('/agenda');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No pudimos activar tu cuenta.');
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
        <Link href="/entrar" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
          Ir a entrar
        </Link>
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
      <h1 className="auth-h1">Te invitaron a un club</h1>
      <p className="auth-sub">Elegí tu contraseña para empezar.</p>

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
        <label className="label" htmlFor="password">Contraseña</label>
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
        {loading ? <><span className="spinner" aria-hidden="true" /> Activando…</> : 'Crear contraseña y entrar'}
      </button>
    </main>
  );
}
