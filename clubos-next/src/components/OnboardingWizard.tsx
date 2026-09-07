'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError, setSession } from '@/lib/api';

/**
 * Wizard de alta de club (self-service).
 *
 * Paso 1: datos del club (nombre + slug con chequeo en vivo).
 * Paso 2: cuenta del dueño.
 * Paso 3: confirmación → crea el club y deja la sesión iniciada → /agenda.
 *
 * El slug se sugiere a partir del nombre del club, pero el usuario puede
 * editarlo. La disponibilidad se consulta con debounce mientras tipea.
 */

type SlugState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'ok' }
  | { status: 'taken'; reason: string };

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // sacar acentos
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function OnboardingWizard() {
  const router = useRouter();

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Club
  const [clubName, setClubName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugState, setSlugState] = useState<SlugState>({ status: 'idle' });
  const [taxId, setTaxId] = useState('');
  const [city, setCity] = useState('');

  // Dueño
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);

  // Slug sugerido desde el nombre, mientras no lo hayan editado a mano.
  useEffect(() => {
    if (!slugTouched) setSlug(slugify(clubName));
  }, [clubName, slugTouched]);

  // Chequeo de disponibilidad del slug con debounce.
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (slug.length < 3) {
      setSlugState({ status: 'idle' });
      return;
    }
    setSlugState({ status: 'checking' });
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await api.onboarding.slugAvailable(slug);
        setSlugState(
          res.available
            ? { status: 'ok' }
            : { status: 'taken', reason: res.reason ?? 'No disponible.' },
        );
      } catch {
        setSlugState({ status: 'idle' });
      }
    }, 350);
    return () => clearTimeout(debounceRef.current);
  }, [slug]);

  const step1Valid =
    clubName.trim().length >= 2 && slug.length >= 3 && slugState.status === 'ok';
  const step2Valid =
    firstName.trim() && lastName.trim() && /\S+@\S+\.\S+/.test(email) &&
    password.length >= 8;

  const submit = useCallback(async () => {
    setLoading(true);
    setAlert(null);
    try {
      const res = await api.onboarding.createClub({
        clubName: clubName.trim(),
        slug,
        taxId: taxId.trim() || undefined,
        city: city.trim() || undefined,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim() || undefined,
        password,
      });

      // Dejar la sesión iniciada, igual que el login.
      const { session, club } = res;
      setSession(session.accessToken, club.id);
      sessionStorage.setItem('clubos.token', session.accessToken);
      sessionStorage.setItem('clubos.club', club.id);
      sessionStorage.setItem('clubos.clubName', club.name);

      setDone(true);
      // Pequeña pausa para que se vea el estado de éxito.
      setTimeout(() => router.push('/agenda'), 1200);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : 'No pudimos crear el club. Probá de nuevo en un momento.';
      setAlert(msg);
      setLoading(false);
    }
  }, [
    clubName, slug, taxId, city, firstName, lastName, email, phone, password,
    router,
  ]);

  if (done) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <div className="success">
            <div className="success-mark">✓</div>
            <h1 className="auth-h1">¡Tu club está listo!</h1>
            <p className="auth-sub">
              Entrando a ClubOS…
            </p>
            <div className="spinner" style={{ margin: '0 auto', borderTopColor: 'var(--pad-red)', borderColor: 'rgba(200,68,62,0.25)' }} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card wide">
        <div className="auth-brand">
          <span className="auth-brand-mark" />
          <span className="auth-brand-name">ClubOS</span>
        </div>

        <div className="stepper" aria-hidden>
          {[1, 2, 3].map((n) => (
            <span
              key={n}
              className={`step-dot ${n === step ? 'active' : n < step ? 'done' : ''}`}
            />
          ))}
        </div>

        {alert && <div className="alert">{alert}</div>}

        {/* -------- Paso 1: Club -------- */}
        {step === 1 && (
          <>
            <div className="step-label">Paso 1 de 3</div>
            <h1 className="auth-h1">Tu club</h1>
            <p className="auth-sub">
              Empecemos con lo básico. Vas a poder cambiar todo esto después.
            </p>

            <div className="field">
              <label className="label" htmlFor="clubName">Nombre del club</label>
              <input
                id="clubName"
                className="input"
                placeholder="Pádel Center San Isidro"
                value={clubName}
                disabled={loading}
                onChange={(e) => { setClubName(e.target.value); setAlert(null); }}
                autoFocus
              />
            </div>

            <div className="field">
              <label className="label" htmlFor="slug">Dirección web</label>
              <div className="input-affix">
                <input
                  id="slug"
                  className="input"
                  placeholder="mi-club"
                  value={slug}
                  disabled={loading}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(slugify(e.target.value));
                  }}
                />
                <span className="suffix">.clubos.com</span>
              </div>
              {slugState.status === 'checking' && (
                <p className="hint">Verificando disponibilidad…</p>
              )}
              {slugState.status === 'ok' && (
                <p className="hint ok">✓ Disponible</p>
              )}
              {slugState.status === 'taken' && (
                <p className="hint bad">{slugState.reason}</p>
              )}
            </div>

            <div className="field-row">
              <div className="field">
                <label className="label" htmlFor="taxId">CUIT (opcional)</label>
                <input
                  id="taxId"
                  className="input"
                  placeholder="30712345678"
                  value={taxId}
                  disabled={loading}
                  inputMode="numeric"
                  onChange={(e) => setTaxId(e.target.value.replace(/\D/g, '').slice(0, 11))}
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="city">Ciudad (opcional)</label>
                <input
                  id="city"
                  className="input"
                  placeholder="San Isidro"
                  value={city}
                  disabled={loading}
                  onChange={(e) => setCity(e.target.value)}
                />
              </div>
            </div>

            <button
              className="btn btn-primary"
              disabled={!step1Valid || loading}
              onClick={() => setStep(2)}
            >
              Continuar
            </button>

            <p className="auth-foot">
              ¿Ya tenés cuenta? <a href="/entrar">Entrá acá</a>
            </p>
          </>
        )}

        {/* -------- Paso 2: Dueño -------- */}
        {step === 2 && (
          <>
            <div className="step-label">Paso 2 de 3</div>
            <h1 className="auth-h1">Tu cuenta</h1>
            <p className="auth-sub">
              Vas a ser el dueño del club, con acceso total.
            </p>

            <div className="field-row">
              <div className="field">
                <label className="label" htmlFor="firstName">Nombre</label>
                <input
                  id="firstName"
                  className="input"
                  value={firstName}
                  disabled={loading}
                  onChange={(e) => setFirstName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="lastName">Apellido</label>
                <input
                  id="lastName"
                  className="input"
                  value={lastName}
                  disabled={loading}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
            </div>

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
              />
            </div>

            <div className="field">
              <label className="label" htmlFor="phone">Teléfono (opcional)</label>
              <input
                id="phone"
                className="input"
                placeholder="+54 11 5555 5555"
                value={phone}
                disabled={loading}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>

            <div className="field">
              <label className="label" htmlFor="password">Contraseña</label>
              <div className="pw-wrap">
                <input
                  id="password"
                  className="input"
                  type={showPw ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="Mínimo 8 caracteres"
                  value={password}
                  disabled={loading}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="pw-toggle"
                  onClick={() => setShowPw((s) => !s)}
                >
                  {showPw ? 'Ocultar' : 'Ver'}
                </button>
              </div>
            </div>

            <div className="btn-row">
              <button className="btn btn-ghost" disabled={loading} onClick={() => setStep(1)}>
                Volver
              </button>
              <button
                className="btn btn-primary"
                disabled={!step2Valid || loading}
                onClick={() => setStep(3)}
              >
                Continuar
              </button>
            </div>
          </>
        )}

        {/* -------- Paso 3: Confirmar -------- */}
        {step === 3 && (
          <>
            <div className="step-label">Paso 3 de 3</div>
            <h1 className="auth-h1">Confirmá y empezá</h1>
            <p className="auth-sub">
              Vas a arrancar con 14 días de prueba. Sin tarjeta por ahora.
            </p>

            <div className="summary">
              <div className="summary-row">
                <span className="k">Club</span>
                <span className="v">{clubName}</span>
              </div>
              <div className="summary-row">
                <span className="k">Dirección</span>
                <span className="v">{slug}.clubos.com</span>
              </div>
              <div className="summary-row">
                <span className="k">Dueño</span>
                <span className="v">{firstName} {lastName}</span>
              </div>
              <div className="summary-row">
                <span className="k">Email</span>
                <span className="v">{email}</span>
              </div>
            </div>

            <p className="auth-sub" style={{ marginBottom: 16 }}>
              Tu club va a arrancar con una cancha, los horarios estándar y los
              medios de pago habituales ya configurados. Todo editable después.
            </p>

            <div className="btn-row">
              <button className="btn btn-ghost" disabled={loading} onClick={() => setStep(2)}>
                Volver
              </button>
              <button className="btn btn-primary" disabled={loading} onClick={() => void submit()}>
                {loading ? <span className="spinner" /> : 'Crear mi club'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
