'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AgendaBoard } from '@/components/AgendaBoard';
import { BookingPanel } from '@/components/BookingPanel';
import { NewBookingDialog } from '@/components/NewBookingDialog';
import { ClientSearch } from '@/components/ClientSearch';
import { Toasts } from '@/components/Toasts';
import { DEMO_DAY, DEMO_CLIENTS } from '@/lib/demo-data';
import { api, type AgendaDay, type ClientSearchResult } from '@/lib/api';
import {
  addDays, formatLocalDate, formatMoney, isToday, todayISO,
} from '@/lib/grid';
import {
  agendaStore, useAgendaStore, useAutoRefresh,
  useHotkeys, useSession, useToasts,
} from '@/hooks';

export function AgendaScreen() {
  const state = useAgendaStore(agendaStore);
  const { session, can } = useSession();
  const { toasts, show, dismiss } = useToasts();

  const [searchOpen, setSearchOpen] = useState(false);
  const [newBooking, setNewBooking] = useState<{ courtId: string; minute: number } | null>(null);

  // Sin sesión no hay backend al que pedirle nada: se muestra el día de
  // ejemplo para que la pantalla se pueda evaluar igual.
  const demo = session === null;
  const day: AgendaDay | null = demo ? DEMO_DAY : state.day;

  useEffect(() => {
    if (!demo) void agendaStore.load(todayISO());
  }, [demo]);

  // Durante un arrastre no se refresca: recargar le arranca el bloque de
  // la mano al operador.
  useAutoRefresh(
    useCallback(() => { if (!demo) void agendaStore.load(); }, [demo]),
    { enabled: !demo },
  );

  const goDay = useCallback((delta: number) => {
    const next = addDays(state.date, delta);
    if (demo) return;
    void agendaStore.goToDate(next);
  }, [state.date, demo]);

  useHotkeys({
    ArrowLeft: () => goDay(-1),
    ArrowRight: () => goDay(1),
    b: () => setSearchOpen(true),
    t: () => { if (!demo) void agendaStore.goToDate(todayISO()); },
    Escape: () => {
      if (searchOpen) setSearchOpen(false);
      else agendaStore.select(null);
    },
  });

  const selected = useMemo(
    () => day?.bookings.find((b) => b.id === state.selectedId) ?? null,
    [day, state.selectedId],
  );
  const selectedCourt = useMemo(
    () => day?.courts.find((c) => c.id === selected?.courtId),
    [day, selected],
  );

  // --- acciones ---

  const handleCollect = useCallback(async (id: string, amount: number) => {
    if (demo) { show('En modo demostración no se registran cobros.', 'error'); return; }
    try {
      const methods = await api.cash.paymentMethods();
      const cash = methods.find((m) => m.kind === 'CASH') ?? methods[0];
      if (!cash) { show('El club no tiene medios de pago configurados.', 'error'); return; }
      const res = await agendaStore.collect(id, cash.id, amount);
      show(res.message, res.ok ? 'ok' : 'error');
    } catch {
      show('No se pudieron cargar los medios de pago.', 'error');
    }
  }, [demo, show]);

  const handleCancel = useCallback(async (id: string) => {
    if (demo) { show('En modo demostración no se cancelan turnos.', 'error'); return; }
    const b = day?.bookings.find((x) => x.id === id);
    if (!confirm(`¿Cancelar el turno de ${b?.title ?? 'este cliente'}?`)) return;
    const res = await agendaStore.cancel(id);
    show(res.message, res.ok ? 'ok' : 'error');
  }, [demo, day, show]);

  const simple = useCallback(
    (fn: (id: string) => Promise<{ ok: boolean; message: string }>) =>
      async (id: string) => {
        if (demo) { show('En modo demostración no se guardan los cambios.', 'error'); return; }
        const res = await fn(id);
        show(res.message, res.ok ? 'ok' : 'error');
      },
    [demo, show],
  );

  const handlePickClient = useCallback((c: ClientSearchResult) => {
    setSearchOpen(false);
    show(`Elegí un horario libre para ${c.firstName} ${c.lastName}.`);
  }, [show]);

  // --- render ---

  if (state.loading && !day) {
    return <div className="app-loading">Cargando la agenda…</div>;
  }

  if (state.error && !day) {
    return (
      <div className="app-error">
        <p>{state.error}</p>
        <button className="btn btn-secondary" onClick={() => void agendaStore.load()}>
          Reintentar
        </button>
      </div>
    );
  }

  if (!day) return null;

  const relative = isToday(state.date)
    ? 'Hoy'
    : state.date === addDays(todayISO(), 1) ? 'Mañana' : '';

  return (
    <>

      <div className="datebar">
        <div className="date-nav">
          <button className="nav-btn" onClick={() => goDay(-1)} aria-label="Día anterior">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <button className="nav-btn" onClick={() => goDay(1)} aria-label="Día siguiente">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6" /></svg>
          </button>
          <button
            className="today-btn"
            onClick={() => { if (!demo) void agendaStore.goToDate(todayISO()); }}
          >
            Hoy
          </button>
        </div>

        <h1 className="current-date">
          {formatLocalDate(state.date)}
          {relative && <span className="date-relative">{relative}</span>}
        </h1>

        <div className="datebar-spacer" />

        <div className="day-stats">
          <Stat
            value={`${Math.round(day.summary.occupancyPercent)}%`}
            label="Ocupación"
            bar={day.summary.occupancyPercent}
          />
          <Stat value={String(day.summary.bookingsCount)} label="Turnos" />
          <Stat value={formatMoney(day.summary.revenue)} label="Cobrado" />
          <Stat
            value={day.summary.pendingRevenue > 0 ? formatMoney(day.summary.pendingRevenue) : '—'}
            label="Por cobrar"
            warn={day.summary.pendingRevenue > 0}
          />
        </div>
      </div>

      <div className="grid-wrap">
        <AgendaBoard
          day={day}
          onSlotClick={(courtId, minute) => {
            if (demo) { show('En modo demostración no se crean turnos.', 'error'); return; }
            setNewBooking({ courtId, minute });
          }}
          onBookingClick={(id) => agendaStore.select(id)}
        />

        <BookingPanel
          booking={selected}
          court={selectedCourt}
          pending={selected ? state.pending.has(selected.id) : false}
          can={can}
          onClose={() => agendaStore.select(null)}
          onCollect={handleCollect}
          onCheckIn={simple((id) => agendaStore.checkIn(id))}
          onCheckOut={simple((id) => agendaStore.checkOut(id))}
          onNoShow={simple((id) => agendaStore.markNoShow(id))}
          onCancel={handleCancel}
        />
      </div>

      <footer className="legend">
        <LegendItem color="var(--state-pending)" label="Falta cobrar" />
        <LegendItem color="var(--state-progress)" label="En curso" />
        <LegendItem color="var(--state-maintenance)" label="Bloqueada" />
        <div className="legend-spacer" />
        <span className="legend-item"><kbd className="kbd">B</kbd> Buscar cliente</span>
        <span className="legend-item">
          <kbd className="kbd">←</kbd><kbd className="kbd">→</kbd> Cambiar día
        </span>
      </footer>

      <ClientSearch
        open={searchOpen}
        demoResults={demo ? DEMO_CLIENTS : undefined}
        onClose={() => setSearchOpen(false)}
        onPick={handlePickClient}
      />

      {newBooking && day && (() => {
        const court = day.courts.find((c) => c.id === newBooking.courtId);
        return (
          <NewBookingDialog
            courtId={newBooking.courtId}
            courtName={court?.name ?? 'Cancha'}
            startMinute={newBooking.minute}
            slotMinutes={court?.slotMinutes ?? 90}
            onClose={() => setNewBooking(null)}
            onCreate={(input) => agendaStore.createBooking(input)}
          />
        );
      })()}

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </>
  );
}

function Stat({ value, label, bar, warn }: {
  value: string; label: string; bar?: number; warn?: boolean;
}) {
  return (
    <div className="stat">
      <span className={`stat-value${warn ? ' is-warn' : ''}`}>{value}</span>
      <span className="stat-label">{label}</span>
      {bar !== undefined && (
        <span className="stat-bar">
          <span style={{ width: `${Math.min(100, bar)}%` }} />
        </span>
      )}
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="legend-item">
      <span className="legend-swatch" style={{ background: color }} />
      {label}
    </span>
  );
}
