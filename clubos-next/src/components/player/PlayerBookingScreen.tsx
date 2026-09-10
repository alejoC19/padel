'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError } from '@/lib/api';
import {
  publicApi,
  type PublicAvailability,
  type PublicClub,
  type PublicCourt,
} from '@/lib/publicApi';
import { savePublicBooking } from '@/lib/publicStorage';
import {
  ALLOWED_DURATIONS,
  buildSlotCandidates,
  isPastSlot,
  isSlotFree,
  type SlotCandidate,
} from '@/lib/publicSlots';
import { addDays, formatDuration, formatLocalDate, formatMinute, todayISO } from '@/lib/grid';

/** Abreviaturas a mano, mismo criterio que grid.ts: evitar que Intl varíe entre navegadores. */
const DOW_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

function shortDayLabel(iso: string): { dow: string; dnum: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const year = Number(match?.[1] ?? 0);
  const month = Number(match?.[2] ?? 1);
  const day = Number(match?.[3] ?? 1);
  const date = new Date(Date.UTC(year, month - 1, day));
  return { dow: DOW_SHORT[date.getUTCDay()] ?? '', dnum: String(day) };
}

const DATE_RANGE_DAYS = 14;

type ClubLoad = { status: 'loading' } | { status: 'not-found' } | { status: 'error'; message: string } | { status: 'ready'; club: PublicClub };
type AvailLoad = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: PublicAvailability };

/**
 * Landing pública del club: disponibilidad del día + formulario de reserva.
 * Punto de entrada natural del portal — es donde apuntaría cualquier link de
 * marketing ("reservá en miclub.clubos.com" → /c/mi-club).
 */
export function PlayerBookingScreen({ slug }: { slug: string }) {
  const router = useRouter();

  const [clubLoad, setClubLoad] = useState<ClubLoad>({ status: 'loading' });
  const [date, setDate] = useState(todayISO());
  const [availLoad, setAvailLoad] = useState<AvailLoad>({ status: 'loading' });
  const [duration, setDuration] = useState<number>(60);
  const [courtId, setCourtId] = useState<string | null>(null);
  const [slotStartsAt, setSlotStartsAt] = useState<string | null>(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadClub = useCallback(async () => {
    setClubLoad({ status: 'loading' });
    try {
      const club = await publicApi.getClub(slug);
      setClubLoad({ status: 'ready', club });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setClubLoad({ status: 'not-found' });
      } else {
        const message = e instanceof ApiError
          ? e.message
          : 'No pudimos cargar este club. Probá de nuevo en un momento.';
        setClubLoad({ status: 'error', message });
      }
    }
  }, [slug]);

  useEffect(() => { void loadClub(); }, [loadClub]);

  const loadAvailability = useCallback(async () => {
    setAvailLoad({ status: 'loading' });
    try {
      const data = await publicApi.availability(slug, date);
      setAvailLoad({ status: 'ready', data });
    } catch (e) {
      const message = e instanceof ApiError
        ? e.message
        : 'No pudimos cargar los horarios. Probá de nuevo en un momento.';
      setAvailLoad({ status: 'error', message });
    }
  }, [slug, date]);

  useEffect(() => {
    if (clubLoad.status !== 'ready') return;
    void loadAvailability();
    // Cambiar de día invalida la selección anterior.
    setCourtId(null);
    setSlotStartsAt(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubLoad.status, date]);

  // Elegir la primera cancha automáticamente cuando llega la disponibilidad.
  useEffect(() => {
    if (availLoad.status !== 'ready') return;
    if (courtId && availLoad.data.courts.some((c) => c.id === courtId)) return;
    setCourtId(availLoad.data.courts[0]?.id ?? null);
  }, [availLoad, courtId]);

  const dateOptions = useMemo(
    () => Array.from({ length: DATE_RANGE_DAYS + 1 }, (_, i) => addDays(todayISO(), i)),
    [],
  );

  const selectedCourt: PublicCourt | undefined =
    availLoad.status === 'ready'
      ? availLoad.data.courts.find((c) => c.id === courtId)
      : undefined;

  const candidates = useMemo<SlotCandidate[]>(
    () =>
      buildSlotCandidates(
        date,
        duration,
        selectedCourt?.openMinute ?? null,
        selectedCourt?.closeMinute ?? null,
      ),
    [date, duration, selectedCourt],
  );

  // Cambiar duración o cancha puede dejar el horario elegido inválido.
  useEffect(() => {
    setSlotStartsAt(null);
  }, [duration, courtId, date]);

  const submit = useCallback(async () => {
    if (clubLoad.status !== 'ready' || !courtId || !slotStartsAt) return;
    if (!firstName.trim() || !phone.trim()) {
      setFormError('Nombre y teléfono son obligatorios.');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await publicApi.reservar(slug, {
        courtId,
        startsAt: slotStartsAt,
        durationMinutes: duration,
        firstName: firstName.trim(),
        lastName: lastName.trim() || undefined,
        phone: phone.trim(),
      });

      const endsAt = new Date(
        new Date(slotStartsAt).getTime() + duration * 60_000,
      ).toISOString();

      savePublicBooking(slug, {
        id: res.booking.id,
        code: res.booking.code,
        accessToken: res.booking.accessToken,
        startsAt: slotStartsAt,
        endsAt,
        courtName: selectedCourt?.name ?? 'Cancha',
        courtColor: selectedCourt?.color ?? null,
        createdAt: new Date().toISOString(),
      });

      router.push(
        `/c/${slug}/reservas/${res.booking.id}?token=${encodeURIComponent(res.booking.accessToken)}&new=1`,
      );
    } catch (e) {
      if (e instanceof ApiError && e.isConflict) {
        setFormError('Justo se ocupó ese horario. Elegí otro.');
        setSlotStartsAt(null);
        void loadAvailability();
      } else {
        setFormError(
          e instanceof ApiError
            ? e.message
            : 'No pudimos crear la reserva. Probá de nuevo en un momento.',
        );
      }
    } finally {
      setSubmitting(false);
    }
  }, [
    clubLoad, courtId, slotStartsAt, firstName, lastName, phone, slug,
    duration, selectedCourt, router, loadAvailability,
  ]);

  // ---- Estados de página completa ----
  if (clubLoad.status === 'loading') {
    return (
      <div className="player-state">
        <div className="spinner" />
        <p>Cargando club…</p>
      </div>
    );
  }
  if (clubLoad.status === 'not-found') {
    return (
      <div className="player-state">
        <div className="state-icon">🎾</div>
        <h2>No encontramos este club</h2>
        <p>Revisá el link — puede que el club haya cambiado de dirección o ya no esté disponible.</p>
      </div>
    );
  }
  if (clubLoad.status === 'error') {
    return (
      <div className="player-state">
        <div className="state-icon">⚠️</div>
        <h2>Algo salió mal</h2>
        <p>{clubLoad.message}</p>
        <button className="btn btn-primary" onClick={() => void loadClub()}>Reintentar</button>
      </div>
    );
  }

  const { club } = clubLoad;

  return (
    <>
      <header className="player-header">
        {club.logoUrl && <img className="player-club-logo" src={club.logoUrl} alt="" />}
        <div className="player-eyebrow">ClubOS</div>
        <h1 className="player-club-name">{club.name}</h1>
        <p className="player-tagline">Reservá tu cancha online, sin registrarte.</p>
        <a className="player-nav-link" href={`/c/${slug}/mis-reservas`}>
          Ver mis reservas →
        </a>
        <a className="player-nav-link" href="/jugador">
          ¿Jugás en otros clubes? Buscalos acá →
        </a>
      </header>

      <section>
        <div className="player-section-title">Elegí el día</div>
        <div className="date-scroller">
          {dateOptions.map((d) => {
            const { dow, dnum } = shortDayLabel(d);
            return (
              <button
                key={d}
                type="button"
                className={`date-chip ${d === date ? 'is-active' : ''}`}
                onClick={() => setDate(d)}
              >
                <span className="dow">{d === todayISO() ? 'hoy' : dow}</span>
                <span className="dnum">{dnum}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <div className="player-section-title">Duración</div>
        <div className="duration-seg">
          {ALLOWED_DURATIONS.map((d) => (
            <button
              key={d}
              type="button"
              className={d === duration ? 'is-active' : ''}
              onClick={() => setDuration(d)}
            >
              {formatDuration(d)}
            </button>
          ))}
        </div>
      </section>

      {availLoad.status === 'loading' && (
        <div className="player-state" style={{ minHeight: 'auto', padding: '32px 16px' }}>
          <div className="spinner" />
          <p>Buscando horarios para el {formatLocalDate(date)}…</p>
        </div>
      )}

      {availLoad.status === 'error' && (
        <div className="player-state" style={{ minHeight: 'auto', padding: '32px 16px' }}>
          <div className="state-icon">⚠️</div>
          <p>{availLoad.message}</p>
          <button className="btn btn-secondary" onClick={() => void loadAvailability()}>Reintentar</button>
        </div>
      )}

      {availLoad.status === 'ready' && availLoad.data.courts.length === 0 && (
        <div className="player-state" style={{ minHeight: 'auto', padding: '32px 16px' }}>
          <div className="state-icon">🏟️</div>
          <p>Este club todavía no tiene canchas configuradas para reservar online.</p>
        </div>
      )}

      {availLoad.status === 'ready' && availLoad.data.courts.length > 0 && (
        <>
          <section>
            <div className="player-section-title">Cancha</div>
            <div className="court-scroller">
              {availLoad.data.courts.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`court-chip ${c.id === courtId ? 'is-active' : ''}`}
                  onClick={() => setCourtId(c.id)}
                >
                  <span className="court-dot" style={{ background: c.color || '#c8443e' }} />
                  {c.name}
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className="player-section-title">
              Horarios disponibles · {formatLocalDate(date)}
            </div>
            {courtId && candidates.length === 0 && (
              <p className="player-empty-note">
                Esta cancha no abre ese día para la duración elegida. Probá otra cancha,
                otra duración o elegí otro día.
              </p>
            )}
            {courtId && candidates.length > 0 && (
              <div className="slot-grid">
                {candidates.map((cand) => {
                  const past = isPastSlot(cand);
                  const free = !past && isSlotFree(cand, courtId, availLoad.data.busy);
                  return (
                    <button
                      key={cand.startMinute}
                      type="button"
                      className={`slot-btn ${cand.startsAt === slotStartsAt ? 'is-selected' : ''}`}
                      disabled={!free}
                      onClick={() => setSlotStartsAt(cand.startsAt)}
                    >
                      {formatMinute(cand.startMinute)}
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}

      {/*
        Fuera del `slotStartsAt && ...` de abajo a propósito: un 409 (choque
        de horario) limpia `slotStartsAt` para forzar a elegir otro turno, y
        si el alert viviera adentro de esa sección desaparecería en el mismo
        render en el que aparece — el jugador nunca llegaría a leerlo.
      */}
      {formError && <div className="alert player-form-alert">{formError}</div>}

      {slotStartsAt && selectedCourt && (
        <section className="booking-form">
          <div className="booking-summary">
            <span>
              {selectedCourt.name} · {formatDuration(duration)}
            </span>
            <span className="muted-line">
              {formatLocalDate(date)} · {formatMinute(
                candidates.find((c) => c.startsAt === slotStartsAt)?.startMinute ?? 0,
              )} hs
            </span>
          </div>

          <div className="field">
            <label className="label" htmlFor="pf-name">Nombre</label>
            <input
              id="pf-name"
              className="input"
              value={firstName}
              disabled={submitting}
              onChange={(e) => { setFirstName(e.target.value); setFormError(null); }}
              placeholder="Tu nombre"
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="pf-lastname">Apellido (opcional)</label>
            <input
              id="pf-lastname"
              className="input"
              value={lastName}
              disabled={submitting}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Tu apellido"
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="pf-phone">Teléfono</label>
            <input
              id="pf-phone"
              className="input"
              type="tel"
              inputMode="tel"
              value={phone}
              disabled={submitting}
              onChange={(e) => { setPhone(e.target.value); setFormError(null); }}
              placeholder="+54 9 11 5555 5555"
            />
            <p className="field-hint">Lo usamos para identificar tu reserva y avisarte si algo cambia.</p>
          </div>

          <div className="sticky-cta">
            <div className="sticky-cta-inner">
              <button className="btn btn-primary" disabled={submitting} onClick={() => void submit()}>
                {submitting ? <span className="spinner" /> : 'Confirmar reserva'}
              </button>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
