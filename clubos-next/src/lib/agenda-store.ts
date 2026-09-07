import { api, ApiError, type AgendaDay, type AgendaBooking } from './api';
import { todayISO } from './grid';

/**
 * Estado de la pantalla de agenda.
 *
 * ---------------------------------------------------------------------------
 * ACTUALIZACIÓN OPTIMISTA Y REVERSIÓN
 * ---------------------------------------------------------------------------
 * Cuando el operador arrastra un turno, el bloque se mueve en el acto y la
 * request sale después. Si el servidor rechaza (409: alguien tomó el horario
 * primero), hay que devolver el bloque a su lugar y explicar por qué.
 *
 * Se hace así y no al revés porque arrastrar y esperar 300ms a que el bloque
 * salte se siente roto. El costo es tener que manejar la reversión bien: si
 * se hace mal, la pantalla queda mostrando algo que no pasó, que es peor que
 * la espera.
 *
 * Regla que sigo: solo se aplica optimismo a operaciones donde el estado
 * previo es recuperable exactamente (mover un turno). Cobrar y cancelar
 * esperan la respuesta, porque el estado resultante depende de cálculos del
 * servidor (comisión, tramo de devolución) que el front no debe adivinar.
 *
 * ---------------------------------------------------------------------------
 * REPROGRAMAR DEVUELVE OTRO ID
 * ---------------------------------------------------------------------------
 * El backend no edita la reserva: la cancela y crea una nueva encadenada,
 * para conservar el historial. Así que después de mover no alcanza con
 * actualizar el bloque — hay que recargar, o el front queda con un id que
 * en el servidor ya está en estado RESCHEDULED.
 * ---------------------------------------------------------------------------
 */

type Listener = () => void;

export interface AgendaState {
  date: string;
  day: AgendaDay | null;
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  /** Operaciones en vuelo, para deshabilitar botones sin bloquear la UI. */
  pending: Set<string>;
}

export class AgendaStore {
  private state: AgendaState = {
    date: todayISO(),
    day: null,
    loading: false,
    error: null,
    selectedId: null,
    pending: new Set(),
  };

  private listeners = new Set<Listener>();
  /** Token de la carga en curso: descarta respuestas de fechas ya abandonadas. */
  private loadToken = 0;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get(): Readonly<AgendaState> {
    return this.state;
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private patch(partial: Partial<AgendaState>): void {
    this.state = { ...this.state, ...partial };
    this.emit();
  }

  // -------------------------------------------------------------------------
  // Carga
  // -------------------------------------------------------------------------

  async load(date = this.state.date): Promise<void> {
    const token = ++this.loadToken;
    this.patch({ date, loading: true, error: null });

    try {
      const day = await api.agenda.day(date);
      // Si el operador cambió de día mientras esto viajaba, descartar:
      // pintar la respuesta vieja sobre el día nuevo es peor que no pintar.
      if (token !== this.loadToken) return;
      this.patch({ day, loading: false });
    } catch (e) {
      if (token !== this.loadToken) return;
      this.patch({
        loading: false,
        error: e instanceof ApiError
          ? e.message
          : 'No se pudo cargar la agenda. Revisá la conexión.',
      });
    }
  }

  async goToDate(date: string): Promise<void> {
    this.patch({ selectedId: null });
    await this.load(date);
  }

  select(id: string | null): void {
    this.patch({ selectedId: id });
  }

  getBooking(id: string): AgendaBooking | undefined {
    return this.state.day?.bookings.find((b) => b.id === id);
  }

  isPending(id: string): boolean {
    return this.state.pending.has(id);
  }

  // -------------------------------------------------------------------------
  // Mover un turno (optimista)
  // -------------------------------------------------------------------------

  /**
   * Mueve un turno a otra cancha u horario.
   *
   * Aplica el cambio en pantalla al instante y revierte si el servidor
   * rechaza. Devuelve el mensaje a mostrar: éxito o el motivo del rechazo.
   */
  async moveBooking(
    id: string,
    newCourtId: string,
    newStartMinute: number,
  ): Promise<{ ok: boolean; message: string }> {
    const day = this.state.day;
    if (!day) return { ok: false, message: 'La agenda no está cargada.' };

    const original = day.bookings.find((b) => b.id === id);
    if (!original) return { ok: false, message: 'La reserva ya no existe.' };

    const duration = original.durationMinutes;
    const newEndMinute = newStartMinute + duration;

    // --- validación local: evita un viaje al servidor para lo obvio ---
    const conflict = this.findConflict(id, newCourtId, newStartMinute, newEndMinute);
    if (conflict) {
      return { ok: false, message: `Ese horario ya está ocupado por ${conflict.title}.` };
    }
    if (newStartMinute < day.openMinute || newEndMinute > day.closeMinute) {
      return { ok: false, message: 'El horario queda fuera del horario de apertura.' };
    }
    if (original.status === 'COMPLETED' || original.status.startsWith('CANCELLED')) {
      return { ok: false, message: 'Una reserva finalizada o cancelada no se mueve.' };
    }

    // --- optimista: se guarda el estado exacto para poder volver ---
    const snapshot = { ...original };
    const startsAt = this.minuteToISO(newStartMinute, day.date, day.timezone);

    this.applyLocal(id, {
      courtId: newCourtId,
      startMinute: newStartMinute,
      endMinute: newEndMinute,
    });
    this.markPending(id, true);

    try {
      await api.bookings.reschedule(id, { startsAt, courtId: newCourtId });

      // El backend creó una reserva NUEVA con otro id. Recargar es la única
      // forma de quedar en sincronía; actualizar el bloque en su lugar dejaría
      // el front apuntando a un id que ya está en RESCHEDULED.
      await this.load(day.date);

      const movedCourt = day.courts.find((c) => c.id === newCourtId);
      const sameCourt = snapshot.courtId === newCourtId;
      return {
        ok: true,
        message: sameCourt
          ? `Turno movido a las ${this.fmt(newStartMinute)}.`
          : `Turno movido a ${movedCourt?.name} ${this.fmt(newStartMinute)}.`,
      };
    } catch (e) {
      // --- reversión ---
      this.applyLocal(id, {
        courtId: snapshot.courtId,
        startMinute: snapshot.startMinute,
        endMinute: snapshot.endMinute,
      });

      if (e instanceof ApiError && e.isOverlap) {
        // Otro operador tomó el horario entre el arrastre y la confirmación.
        // Recargar para que vea la reserva que apareció.
        await this.load(day.date);
        return {
          ok: false,
          message: 'Alguien reservó ese horario mientras lo movías. Actualizamos la agenda.',
        };
      }

      return {
        ok: false,
        message: e instanceof ApiError ? e.message : 'No se pudo mover el turno.',
      };
    } finally {
      this.markPending(id, false);
    }
  }

  // -------------------------------------------------------------------------
  // Operaciones que esperan respuesta
  // -------------------------------------------------------------------------

  /**
   * Cobra el saldo de una reserva.
   *
   * No es optimista: el monto neto depende de la comisión del medio de pago,
   * que calcula el servidor. Mostrar un número y corregirlo después es peor
   * que esperar 200ms.
   */
  async collect(
    id: string,
    paymentMethodId: string,
    amount: number,
  ): Promise<{ ok: boolean; message: string }> {
    this.markPending(id, true);
    try {
      const res = await api.bookings.collect(id, { paymentMethodId, amount });
      await this.load(this.state.date);
      return {
        ok: true,
        message: res.paymentStatus === 'PAID'
          ? `Cobrado ${this.money(amount)}. Turno saldado.`
          : `Cobrado ${this.money(amount)}. Queda saldo pendiente.`,
      };
    } catch (e) {
      if (e instanceof ApiError && e.needsCashSession) {
        return {
          ok: false,
          message: 'No hay una caja abierta. Abrí la caja para poder cobrar en efectivo.',
        };
      }
      return {
        ok: false,
        message: e instanceof ApiError ? e.message : 'No se pudo registrar el cobro.',
      };
    } finally {
      this.markPending(id, false);
    }
  }

  /**
   * Cancela un turno.
   *
   * El monto de devolución lo decide la política del club según la
   * antelación, así que hay que esperar al servidor para poder decir cuánto
   * se devolvió.
   */
  async cancel(
    id: string,
    reason?: string,
    cancelledBy: 'CLIENT' | 'CLUB' = 'CLIENT',
  ): Promise<{ ok: boolean; message: string }> {
    this.markPending(id, true);
    try {
      const res = await api.bookings.cancel(id, { cancelledBy, reason });
      await this.load(this.state.date);
      this.patch({ selectedId: null });

      return {
        ok: true,
        message: res.refundAmount > 0
          ? `Turno cancelado. Se devuelven ${this.money(res.refundAmount)} — ${res.tierApplied.toLowerCase()}.`
          : `Turno cancelado sin devolución — ${res.tierApplied.toLowerCase()}.`,
      };
    } catch (e) {
      return {
        ok: false,
        message: e instanceof ApiError ? e.message : 'No se pudo cancelar el turno.',
      };
    } finally {
      this.markPending(id, false);
    }
  }

  async checkIn(id: string): Promise<{ ok: boolean; message: string }> {
    this.markPending(id, true);
    try {
      await api.bookings.checkIn(id);
      await this.load(this.state.date);
      const b = this.getBooking(id);
      return { ok: true, message: `Llegó ${b?.title ?? 'el cliente'}.` };
    } catch (e) {
      return {
        ok: false,
        message: e instanceof ApiError ? e.message : 'No se pudo registrar la llegada.',
      };
    } finally {
      this.markPending(id, false);
    }
  }

  /** Cierra el turno cuando el cliente se va. */
  async checkOut(id: string): Promise<{ ok: boolean; message: string }> {
    this.markPending(id, true);
    try {
      await api.bookings.checkOut(id);
      await this.load(this.state.date);
      return { ok: true, message: 'Turno cerrado.' };
    } catch (e) {
      return {
        ok: false,
        message: e instanceof ApiError ? e.message : 'No se pudo cerrar el turno.',
      };
    } finally {
      this.markPending(id, false);
    }
  }

  async markNoShow(id: string, reason?: string): Promise<{ ok: boolean; message: string }> {
    this.markPending(id, true);
    try {
      const res = await api.bookings.noShow(id, reason);
      await this.load(this.state.date);
      this.patch({ selectedId: null });
      return {
        ok: true,
        message: res.charged > 0
          ? `Marcado como ausente. Se cargaron ${this.money(res.charged)} a su cuenta.`
          : 'Marcado como ausente.',
      };
    } catch (e) {
      return {
        ok: false,
        message: e instanceof ApiError ? e.message : 'No se pudo marcar la ausencia.',
      };
    } finally {
      this.markPending(id, false);
    }
  }

  async createBooking(input: {
    courtId: string;
    startMinute: number;
    durationMinutes: number;
    clientId?: string;
    playersCount?: number;
    payment?: { paymentMethodId?: string; amount: number; toAccount?: boolean };
  }): Promise<{ ok: boolean; message: string; id?: string }> {
    const day = this.state.day;
    if (!day) return { ok: false, message: 'La agenda no está cargada.' };

    try {
      const res = await api.bookings.create({
        courtId: input.courtId,
        startsAt: this.minuteToISO(input.startMinute, day.date, day.timezone),
        durationMinutes: input.durationMinutes,
        clientId: input.clientId,
        playersCount: input.playersCount,
        payment: input.payment,
      });
      await this.load(day.date);
      return {
        ok: true,
        id: res.id,
        message: res.paidAmount >= res.totalPrice
          ? `Turno ${res.code} creado y cobrado.`
          : `Turno ${res.code} creado. Falta cobrar ${this.money(res.totalPrice - res.paidAmount)}.`,
      };
    } catch (e) {
      if (e instanceof ApiError && e.isOverlap) {
        await this.load(day.date);
        return {
          ok: false,
          message: 'Alguien tomó ese horario recién. Actualizamos la agenda.',
        };
      }
      return {
        ok: false,
        message: e instanceof ApiError ? e.message : 'No se pudo crear el turno.',
      };
    }
  }

  // -------------------------------------------------------------------------
  // Internos
  // -------------------------------------------------------------------------

  /** Chequeo local de solapamiento. La verdad la tiene Postgres. */
  private findConflict(
    ignoreId: string,
    courtId: string,
    startMinute: number,
    endMinute: number,
  ): AgendaBooking | undefined {
    return this.state.day?.bookings.find(
      (b) =>
        b.id !== ignoreId &&
        b.courtId === courtId &&
        !b.status.startsWith('CANCELLED') &&
        b.status !== 'NO_SHOW' &&
        b.status !== 'RESCHEDULED' &&
        startMinute < b.endMinute &&
        endMinute > b.startMinute,
    );
  }

  private applyLocal(id: string, changes: Partial<AgendaBooking>): void {
    const day = this.state.day;
    if (!day) return;
    this.patch({
      day: {
        ...day,
        bookings: day.bookings.map((b) =>
          b.id === id ? { ...b, ...changes } : b,
        ),
      },
    });
  }

  private markPending(id: string, on: boolean): void {
    const next = new Set(this.state.pending);
    if (on) next.add(id);
    else next.delete(id);
    this.patch({ pending: next });
  }

  /**
   * Minuto del día local → instante ISO absoluto.
   *
   * Se calcula el offset real de la zona del club para esa fecha en vez de
   * asumir uno fijo: Argentina no tiene horario de verano, pero el sistema
   * soporta clubes en zonas que sí.
   */
  private minuteToISO(minute: number, date: string, timeZone: string): string {
    const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!parsed) throw new Error(`Fecha inválida: ${date}`);
    const y = Number(parsed[1]);
    const m = Number(parsed[2]);
    const d = Number(parsed[3]);
    const h = Math.floor(minute / 60);
    const min = minute % 60;

    // Estimación tratando la hora local como UTC, luego corrección por offset.
    let guess = new Date(Date.UTC(y, m - 1, d, h, min));
    for (let i = 0; i < 2; i++) {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }).formatToParts(guess);
      const g: Record<string, number> = {};
      for (const p of parts) if (p.type !== 'literal') g[p.type] = Number(p.value);
      if (g.hour === 24) g.hour = 0;
      const asUtc = Date.UTC(
        g.year ?? y, (g.month ?? m) - 1, g.day ?? d,
        g.hour ?? h, g.minute ?? min, g.second ?? 0,
      );
      const offset = (asUtc - guess.getTime()) / 60_000;
      const corrected = new Date(Date.UTC(y, m - 1, d, h, min) - offset * 60_000);
      if (corrected.getTime() === guess.getTime()) break;
      guess = corrected;
    }
    return guess.toISOString();
  }

  private fmt(minute: number): string {
    const h = Math.floor(minute / 60) % 24;
    const m = minute % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  private money(n: number): string {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency', currency: 'ARS', maximumFractionDigits: 0,
    }).format(n);
  }
}
