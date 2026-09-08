'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { Ball, PadelDefs } from '@/components/marketing/Art';
import { api } from '@/lib/api';

/**
 * "Olvidé mi contraseña". Siempre muestra el mismo mensaje de éxito, exista
 * o no la cuenta — el backend ya se cuida de no revelar cuál es el caso
 * (mismo criterio que el login), el front no debe arruinarlo con un mensaje
 * distinto para "no encontramos esa cuenta".
 */
export function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setError('Ingresá tu email.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.auth.forgotPassword(trimmed);
      setSent(true);
    } catch {
      // Incluso si algo falla (ej. rate limit), no distinguimos el motivo acá
      // por el mismo criterio de no-enumeración — el rate limit ya cortó el
      // abuso del lado del backend.
      setSent(true);
    } finally {
      setLoading(false);
    }
  }, [email]);

  if (sent) {
    return (
      <main className="auth-card">
        <PadelDefs />
        <div className="auth-brand">
          <Ball size={26} />
          <span className="auth-brand-name">ClubOS</span>
        </div>
        <h1 className="auth-h1">Revisá tu email</h1>
        <p className="auth-sub">
          Si existe una cuenta con ese email, te mandamos un link para
          restablecer la contraseña. Vence en 1 hora.
        </p>
        <Link href="/entrar" className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center' }}>
          Volver a entrar
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
      <h1 className="auth-h1">Olvidé mi contraseña</h1>
      <p className="auth-sub">Te mandamos un link para elegir una nueva.</p>

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
        <label className="label" htmlFor="email">Email</label>
        <input
          id="email"
          className="input"
          type="email"
          autoFocus
          autoComplete="username"
          placeholder="tu@club.com.ar"
          value={email}
          disabled={loading}
          onChange={(e) => { setEmail(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
        />
      </div>

      <button className="btn btn-primary" disabled={loading} onClick={() => void submit()}>
        {loading ? <><span className="spinner" aria-hidden="true" /> Enviando…</> : 'Enviar link'}
      </button>

      <div className="auth-foot">
        <Link href="/entrar" className="auth-link-muted">Volver a entrar</Link>
      </div>
    </main>
  );
}
