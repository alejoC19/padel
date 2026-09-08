'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Ball, PadelDefs } from '@/components/marketing/Art';
import { setSession } from '@/lib/api';

/**
 * Entrada al sistema.
 *
 * ---------------------------------------------------------------------------
 * MENSAJES DE ERROR
 * ---------------------------------------------------------------------------
 * Nunca se distingue "el email no existe" de "la contraseña está mal".
 * Distinguirlos permite averiguar qué emails están registrados en el sistema.
 * El backend ya iguala los tiempos de respuesta con un hash dummy; el front
 * no debe arruinarlo con un mensaje más específico.
 *
 * ---------------------------------------------------------------------------
 * DÓNDE VIVE LA SESIÓN
 * ---------------------------------------------------------------------------
 * sessionStorage, no localStorage: en una recepción con la computadora
 * compartida, cerrar la pestaña debe cerrar la sesión. El refresh token va en
 * cookie httpOnly que pone el servidor, así que un XSS no se lleva la sesión
 * larga.
 *
 * IMPORTANTE: además de guardar en sessionStorage (para sobrevivir un F5),
 * hay que avisarle a la capa de API (setSession) para que meta el token y el
 * club en los headers de cada request. Sin esto, el backend recibe las
 * llamadas sin el club activo y responde 403 "Contexto no disponible".
 * ---------------------------------------------------------------------------
 */

interface ClubOption {
  id: string;
  name: string;
  slug: string;
  roleCode: string;
  status: string;
}

interface LoginResponse {
  accessToken: string;
  activeClub: ClubOption | null;
  clubs: ClubOption[];
  permissions: string[];
  user: { id: string; firstName: string; lastName: string };
}

const ROLE_LABEL: Record<string, string> = {
  OWNER: 'Dueño',
  ADMIN: 'Administrador',
  RECEPTION: 'Recepción',
  INSTRUCTOR: 'Profesor',
  CLIENT: 'Cliente',
};

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let payload: Record<string, unknown> = {};
    try { payload = await res.json(); } catch { /* sin cuerpo */ }
    const err = new Error(String(payload.message ?? `Error ${res.status}`)) as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

export function LoginScreen() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState<{ message: string; hint?: string } | null>(null);
  const [clubs, setClubs] = useState<ClubOption[] | null>(null);
  const [backendUp, setBackendUp] = useState<boolean | null>(null);

  /**
   * Chequeo del backend al cargar.
   *
   * Un 401 confirma que el servidor está: la ruta existe y respondió. Un 200
   * significa que ya hay sesión, así que no tiene sentido pedir el login de
   * nuevo.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
        if (cancelled) return;
        setBackendUp(true);
        if (res.ok) {
          const me = (await res.json()) as { clubId: string | null };
          if (me.clubId) router.replace('/agenda');
        }
      } catch {
        if (!cancelled) setBackendUp(false);
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  const enterApp = useCallback((res: LoginResponse) => {
    if (!res.activeClub) return;
    // 1) Persistencia para sobrevivir un refresh de página.
    sessionStorage.setItem('clubos.token', res.accessToken);
    sessionStorage.setItem('clubos.club', res.activeClub.id);
    sessionStorage.setItem('clubos.clubName', res.activeClub.name);
    sessionStorage.setItem('clubos.user', `${res.user.firstName} ${res.user.lastName}`);
    sessionStorage.setItem('clubos.permissions', JSON.stringify(res.permissions));
    // 2) Avisarle a la capa de API para que mande token + club en cada request.
    //    SIN esto, las llamadas van sin club y el backend responde 403.
    setSession(res.accessToken, res.activeClub.id);
    router.push('/agenda');
  }, [router]);

  const submit = useCallback(async (clubId?: string) => {
    setAlert(null);

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !password) {
      setAlert({ message: 'Completá email y contraseña.' });
      return;
    }

    if (backendUp === false) {
      setAlert({
        message: 'No hay conexión con el servidor.',
        hint: 'Verificá que el backend esté levantado, o mirá la agenda de ejemplo.',
      });
      return;
    }

    setLoading(true);
    try {
      const res = await apiPost<LoginResponse>('/auth/login', {
        email: trimmedEmail, password, clubId,
      });

      // Varios clubes y ninguno elegido: el backend devuelve activeClub null.
      if (!res.activeClub && res.clubs.length > 1) {
        setClubs(res.clubs);
        return;
      }
      if (!res.activeClub) {
        setAlert({
          message: 'Tu cuenta no tiene ningún club asignado.',
          hint: 'Pedile al dueño del club que te invite.',
        });
        return;
      }
      enterApp(res);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 401) {
        // Mismo mensaje siempre: distinguir permite enumerar cuentas.
        setAlert({ message: 'Email o contraseña incorrectos.' });
        setPassword('');
      } else if (err.status === 429) {
        setAlert({
          message: 'Demasiados intentos.',
          hint: 'Esperá un minuto antes de volver a probar.',
        });
      } else if (err.status === 403) {
        setAlert({ message: err.message, hint: 'Contactá al administrador del club.' });
      } else {
        setAlert({ message: 'No pudimos entrar.', hint: err.message });
      }
    } finally {
      setLoading(false);
    }
  }, [email, password, backendUp, enterApp]);

  // --- paso 2: elegir club ---
  if (clubs) {
    return (
      <main className="auth-card">
        <PadelDefs />
        <button className="back-btn" onClick={() => { setClubs(null); setPassword(''); }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Volver
        </button>
        <h1 className="auth-h1">¿A qué club entrás?</h1>
        <p className="auth-sub">
          Tenés acceso a {clubs.length} clubes. Elegí con cuál trabajar.
        </p>
        <div className="clubs">
          {clubs.map((c) => (
            <button
              key={c.id}
              className="club"
              disabled={loading}
              onClick={() => { setClubs(null); void submit(c.id); }}
            >
              <span className="club-mark">
                {c.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
              </span>
              <span className="club-body">
                <span className="club-name">{c.name}</span>
                <span className="club-role">{ROLE_LABEL[c.roleCode] ?? c.roleCode}</span>
              </span>
              {c.status === 'PAST_DUE' ? (
                <span className="club-warn">Pago pendiente</span>
              ) : (
                <span className="club-arrow" aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                       stroke="currentColor" strokeWidth="2.5">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </span>
              )}
            </button>
          ))}
        </div>
      </main>
    );
  }

  // --- paso 1: credenciales ---
  return (
    <main className="auth-card">
      <PadelDefs />

      <div className="auth-brand">
        <Ball size={26} />
        <span className="auth-brand-name">ClubOS</span>
      </div>

      <h1 className="auth-h1">Entrar</h1>
      <p className="auth-sub">Ingresá con tu cuenta del club.</p>

      {alert && (
        <div className="alert" role="alert">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
            <circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" />
          </svg>
          <div>
            <div>{alert.message}</div>
            {alert.hint && <div className="alert-hint">{alert.hint}</div>}
          </div>
        </div>
      )}

      <div className="field">
        <label className="label" htmlFor="email">Email</label>
        <input
          id="email"
          className="input"
          type="email"
          autoComplete="username"
          placeholder="tu@club.com.ar"
          value={email}
          disabled={loading}
          onChange={(e) => { setEmail(e.target.value); setAlert(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
        />
      </div>

      <div className="field">
        <label className="label" htmlFor="password">Contraseña</label>
        <div className="pw-wrap">
          <input
            id="password"
            className="input"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            disabled={loading}
            onChange={(e) => { setPassword(e.target.value); setAlert(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          />
          <button
            type="button"
            className="pw-toggle"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            aria-pressed={showPassword}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2" aria-hidden="true">
              {showPassword ? (
                <>
                  <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-10-8-10-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 10 8 10 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
                  <path d="M1 1l22 22" />
                </>
              ) : (
                <>
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                  <circle cx="12" cy="12" r="3" />
                </>
              )}
            </svg>
          </button>
        </div>
      </div>

      <button className="btn btn-primary" disabled={loading} onClick={() => void submit()}>
        {loading ? <><span className="spinner" aria-hidden="true" /> Entrando…</> : 'Entrar'}
      </button>

      <div className="auth-foot">
        <Link href="/olvide-password" className="auth-link-muted">
          ¿Olvidaste la contraseña?
        </Link>
      </div>

      {backendUp === false && (
        <div className="demo-note">
          <b>No hay conexión con el servidor.</b>
          <br />
          Podés ver la agenda con datos de ejemplo mientras tanto.
          <div style={{ marginTop: 8 }}>
            <a className="demo-link" href="/agenda">Ver la agenda de ejemplo →</a>
          </div>
        </div>
      )}
    </main>
  );
}
