'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AgendaBoard } from '@/components/AgendaBoard';
import { BookingPanel } from '@/components/BookingPanel';
import { NewBookingDialog } from '@/components/NewBookingDialog';
import { MoveBookingDialog } from '@/components/MoveBookingDialog';
import { CourtOverviewStrip } from '@/components/CourtOverviewStrip';
import { ClientSearch } from '@/components/ClientSearch';
import { Toasts } from '@/components/Toasts';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
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
  const { can, isDemo } = useSession();
  const { toasts, show, dismiss } = useToasts();

  const [searchOpen, setSearchOpen] = useState(false);
  const [newBooking, setNewBooking] = useState<{ courtId: string; minute: number } | null>(null);
  const [courtId, setCourtId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // Sin sesión no hay backend al que pedirle nada: se muestra el día de
  // ejemplo para que la pantalla se pueda evaluar igual.
  const demo = isDemo;
  const day: AgendaDay | null = demo ? DEMO_DAY : state.day;
  // En modo demo se muestran todas las acciones del panel de turno (no hay
  // sesión real de la que sacar permisos); con sesión, el permiso real manda.
  const canOrDemo = useCallback(
    (permission: string) => demo || can(permission),
    [demo, can],
  );

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

  const handleCancel = useCallback((id: string) => {
    if (demo) { show('En modo demostración no se cancelan turnos.', 'error'); return; }
    setCancelId(id);
  }, [demo, show]);

  const confirmCancel = useCallback(async () => {
    if (!cancelId) return;
    setCancelling(true);
    const res = await agendaStore.cancel(cancelId);
    setCancelling(false);
    setCancelId(null);
    show(res.message, res.ok ? 'ok' : 'error');
  }, [cancelId, show]);

  const handleMove = useCallback(async (id: string, targetCourtId: string, startMinute: number) => {
    const res = await agendaStore.moveBooking(id, targetCourtId, startMinute);
    if (res.ok) show(res.message);
    return res;
  }, [show]);

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

  // Se recalcula en vez de guardar en el propio estado del courtId: si el
  // día cambia (otra fecha, o el store recarga) y la cancha seleccionada ya
  // no existe en el nuevo `day.courts`, cae sola a la primera en vez de
  // quedar apuntando a un id que no está.
  const activeCourtId = (courtId && day.courts.some((c) => c.id === courtId))
    ? courtId
    : day.courts[0]?.id ?? '';

  const movingBooking = movingId ? day.bookings.find((b) => b.id === movingId) ?? null : null;
  const cancelBooking = cancelId ? day.bookings.find((b) => b.id === cancelId) ?? null : null;

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
          <DayVital
            value={`${Math.round(day.summary.occupancyPercent)}%`}
            label="Ocupación"
            bar={day.summary.occupancyPercent}
          />
          <DayVital value={String(day.summary.bookingsCount)} label="Turnos" />
          <DayVital value={formatMoney(day.summary.revenue)} label="Cobrado" />
          <DayVital
            value={day.summary.pendingRevenue > 0 ? formatMoney(day.summary.pendingRevenue) : '—'}
            label="Por cobrar"
            warn={day.summary.pendingRevenue > 0}
          />
        </div>
      </div>

      <CourtOverviewStrip
        day={day}
        selectedCourtId={activeCourtId}
        onSelectCourt={setCourtId}
      />

      <div className="grid-wrap">
        <AgendaBoard
          day={day}
          courtId={activeCourtId}
          onSlotClick={(clickedCourtId, minute) => {
            if (demo) { show('En modo demostración no se crean turnos.', 'error'); return; }
            setNewBooking({ courtId: clickedCourtId, minute });
          }}
          onBookingClick={(id) => agendaStore.select(id)}
        />

        <BookingPanel
          booking={selected}
          court={selectedCourt}
          pending={selected ? state.pending.has(selected.id) : false}
          can={canOrDemo}
          onClose={() => agendaStore.select(null)}
          onCollect={handleCollect}
          onCheckIn={simple((id) => agendaStore.checkIn(id))}
          onCheckOut={simple((id) => agendaStore.checkOut(id))}
          onNoShow={simple((id) => agendaStore.markNoShow(id))}
          onCancel={handleCancel}
          onMove={(id) => {
            if (demo) { show('En modo demostración no se mueven turnos.', 'error'); return; }
            setMovingId(id);
          }}
        />
      </div>

      <footer className="legend">
        <LegendItem color="var(--state-pending)" label="Falta cobrar" />
        <LegendItem color="var(--state-progress)" label="En curso" />
        <LegendItem color="var(--state-maintenance)" label="Bloqueada" />
        <div className="legend-spacer" />
        <span className="legend-item legend-kbd-hint"><kbd className="kbd">B</kbd> Buscar cliente</span>
        <span className="legend-item legend-kbd-hint">
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

      {movingBooking && (
        <MoveBookingDialog
          booking={movingBooking}
          courts={day.courts}
          onClose={() => setMovingId(null)}
          onMove={handleMove}
        />
      )}

      <ConfirmDialog
        open={cancelBooking !== null}
        title="Cancelar turno"
        message={`¿Cancelar el turno de ${cancelBooking?.title ?? 'este cliente'}? Esta acción no se puede deshacer.`}
        confirmLabel="Cancelar turno"
        cancelLabel="Volver"
        danger
        busy={cancelling}
        onConfirm={confirmCancel}
        onCancel={() => setCancelId(null)}
      />

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </>
  );
}

/**
 * Un número del día, sin caja ni borde propio.
 *
 * Antes eran 4 `.stat` idénticas (borde + fondo + sombra cada una) — el
 * mismo patrón de "toda métrica es una card" que hace que un dashboard se
 * vea genérico. Ocupación/Turnos/Cobrado/Por cobrar son UNA sola idea ("así
 * viene el día"), no cuatro widgets separados: van en fila, separadas por
 * una línea fina, y el color hace el trabajo de avisar "esto necesita
 * atención" en vez de un badge.
 */
function DayVital({ value, label, bar, warn }: {
  value: string; label: string; bar?: number; warn?: boolean;
}) {
  return (
    <div className="day-vital">
      <span className={`day-vital-value${warn ? ' is-warn' : ''}`}>{value}</span>
      <span className="day-vital-label">{label}</span>
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
