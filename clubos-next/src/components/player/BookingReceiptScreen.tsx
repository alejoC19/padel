'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ApiError } from '@/lib/api';
import { publicApi, type PublicBookingDetail } from '@/lib/publicApi';
import { getPublicBooking } from '@/lib/publicStorage';
import { formatLocalDate, formatMinute, formatMoney } from '@/lib/grid';

type Load =
  | { status: 'loading' }
  | { status: 'no-token' }
  | { status: 'not-found' }
  | { status: 'error'; message: string }
  | { status: 'ready'; detail: PublicBookingDetail };

const STATUS_LABEL: Record<string, string> = {
  CONFIRMED: 'Confirmada',
  PENDING: 'Pendiente',
  CANCELLED_BY_CLIENT: 'Cancelada por vos',
  CANCELLED_BY_CLUB: 'Cancelada por el club',
  NO_SHOW: 'No se presentó',
  COMPLETED: 'Jugada',
};

const PAYMENT_LABEL: Record<string, string> = {
  PAID: 'Pagado',
  PARTIAL: 'Pago parcial',
  PENDING: 'Pendiente de pago',
};

/**
 * Comprobante / detalle de una reserva. Es la pantalla a la que apunta el
 * link que se le entrega al jugador al reservar (bookmarkeable: el token
 * viaja en el query string).
 */
export function BookingReceiptScreen({ slug, id }: { slug: string; id: string }) {
  const searchParams = useSearchParams();
  const urlToken = searchParams.get('token');

  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [checkoutInfo, setCheckoutInfo] = useState<string | null>(null);
  const [copyOk, setCopyOk] = useState(false);

  // El token efectivo (URL o, en su defecto, lo guardado en este
  // dispositivo) y el origin para armar el link completo se resuelven en un
  // efecto — no durante el render — porque ambos dependen de localStorage /
  // window, que en el servidor no existen. Leerlos directo en el cuerpo del
  // componente produce HTML de servidor y de cliente distintos (mismatch de
  // hidratación) apenas la reserva ya está guardada en este dispositivo.
  const [effectiveToken, setEffectiveToken] = useState<string | null>(null);
  const [tokenResolved, setTokenResolved] = useState(false);
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    setOrigin(window.location.origin);
    setEffectiveToken(urlToken ?? getPublicBooking(slug, id)?.accessToken ?? null);
    setTokenResolved(true);
  }, [urlToken, slug, id]);

  const load1 = useCallback(async () => {
    if (!tokenResolved) return;
    setLoad({ status: 'loading' });
    if (!effectiveToken) {
      setLoad({ status: 'no-token' });
      return;
    }
    try {
      const detail = await publicApi.consultar(slug, id, effectiveToken);
      setLoad({ status: 'ready', detail });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setLoad({ status: 'not-found' });
      } else {
        const message = e instanceof ApiError
          ? e.message
          : 'No pudimos cargar la reserva. Probá de nuevo en un momento.';
        setLoad({ status: 'error', message });
      }
    }
  }, [slug, id, effectiveToken, tokenResolved]);

  useEffect(() => { void load1(); }, [load1]);

  const receiptUrl = effectiveToken && origin
    ? `${origin}/c/${slug}/reservas/${id}?token=${encodeURIComponent(effectiveToken)}`
    : '';

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(receiptUrl);
      setCopyOk(true);
      setTimeout(() => setCopyOk(false), 2000);
    } catch {
      // Clipboard puede fallar (permiso, http no seguro). El input queda
      // seleccionable igual para copiar a mano.
    }
  }, [receiptUrl]);

  const payOnline = useCallback(async () => {
    if (!effectiveToken) return;
    setActionBusy(true);
    setActionError(null);
    setCheckoutInfo(null);
    try {
      const { initPoint } = await publicApi.checkout(slug, id, effectiveToken);
      window.location.href = initPoint;
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) {
        // Estado esperado y normal: muchos clubes todavía no conectaron MP.
        // La reserva sigue siendo válida, se paga en el club.
        setCheckoutInfo(e.message);
      } else {
        setActionError(
          e instanceof ApiError ? e.message : 'No pudimos iniciar el pago. Probá de nuevo.',
        );
      }
    } finally {
      setActionBusy(false);
    }
  }, [slug, id, effectiveToken]);

  const confirmCancel = useCallback(async () => {
    if (!effectiveToken) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await publicApi.cancelar(slug, id, effectiveToken);
      setConfirmingCancel(false);
      void load1();
    } catch (e) {
      setActionError(
        e instanceof ApiError ? e.message : 'No pudimos cancelar la reserva. Probá de nuevo.',
      );
    } finally {
      setActionBusy(false);
    }
  }, [slug, id, effectiveToken, load1]);

  if (load.status === 'loading') {
    return (
      <div className="player-state">
        <div className="spinner" />
        <p>Cargando tu reserva…</p>
      </div>
    );
  }

  if (load.status === 'no-token') {
    return (
      <div className="player-state">
        <div className="state-icon">🔒</div>
        <h2>No encontramos esta reserva en este dispositivo</h2>
        <p>Usá el link que te enviamos al reservar — es tu comprobante único, con un código que no se puede adivinar.</p>
        <a className="btn btn-secondary" href={`/c/${slug}/mis-reservas`}>Buscar por teléfono</a>
      </div>
    );
  }

  if (load.status === 'not-found') {
    return (
      <div className="player-state">
        <div className="state-icon">🔎</div>
        <h2>Reserva no encontrada</h2>
        <p>El link puede estar incompleto o la reserva no existe. Revisá que copiaste la dirección completa.</p>
      </div>
    );
  }

  if (load.status === 'error') {
    return (
      <div className="player-state">
        <div className="state-icon">⚠️</div>
        <h2>Algo salió mal</h2>
        <p>{load.message}</p>
        <button className="btn btn-primary" onClick={() => void load1()}>Reintentar</button>
      </div>
    );
  }

  const { detail } = load;
  const isCancelled = detail.status.startsWith('CANCELLED');
  const pending = Math.max(0, detail.totalPrice - detail.paidAmount);

  return (
    <>
      <header className="player-header">
        <div className="player-eyebrow">Comprobante</div>
        <div className="receipt-code">{detail.code}</div>
      </header>

      <section className="card">
        <div className="receipt-row">
          <span className="k">Cancha</span>
          <span className="v">
            <span className="court-dot" style={{ background: detail.courtColor || '#c8443e', display: 'inline-block', marginRight: 6, verticalAlign: 'middle' }} />
            {detail.courtName}
          </span>
        </div>
        <div className="receipt-row">
          <span className="k">Día</span>
          <span className="v">{formatLocalDate(detail.startsAt.slice(0, 10))}</span>
        </div>
        <div className="receipt-row">
          <span className="k">Horario</span>
          <span className="v">
            {formatMinute(new Date(detail.startsAt).getHours() * 60 + new Date(detail.startsAt).getMinutes())}
            {' – '}
            {formatMinute(new Date(detail.endsAt).getHours() * 60 + new Date(detail.endsAt).getMinutes())}
          </span>
        </div>
        <div className="receipt-row">
          <span className="k">Estado</span>
          <span className={`badge ${isCancelled ? 'danger' : 'success'}`}>
            {STATUS_LABEL[detail.status] ?? detail.status}
          </span>
        </div>
        <div className="receipt-row">
          <span className="k">Pago</span>
          <span className={`badge ${detail.paymentStatus === 'PAID' ? 'success' : 'warning'}`}>
            {PAYMENT_LABEL[detail.paymentStatus] ?? detail.paymentStatus}
          </span>
        </div>
        <div className="receipt-row">
          <span className="k">Total</span>
          <span className="v">{formatMoney(detail.totalPrice)}</span>
        </div>
        {detail.paidAmount > 0 && (
          <div className="receipt-row">
            <span className="k">Pagado</span>
            <span className="v">{formatMoney(detail.paidAmount)}</span>
          </div>
        )}
        {pending > 0 && (
          <div className="receipt-row">
            <span className="k">Saldo pendiente</span>
            <span className="v">{formatMoney(pending)}</span>
          </div>
        )}
      </section>

      <section>
        <div className="player-section-title">Guardá este link</div>
        <p className="field-hint" style={{ marginBottom: 8 }}>
          Es tu comprobante: te deja ver o cancelar esta reserva más adelante. También lo guardamos en este dispositivo.
        </p>
        <div className="token-box">
          <input readOnly value={receiptUrl} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="btn btn-mini" onClick={() => void copyLink()}>
            {copyOk ? '¡Copiado!' : 'Copiar'}
          </button>
        </div>
      </section>

      {checkoutInfo && <div className="info-banner">{checkoutInfo}</div>}
      {actionError && <div className="alert">{actionError}</div>}

      {!isCancelled && (
        <section className="receipt-actions">
          {detail.paymentStatus !== 'PAID' && (
            <button className="btn btn-primary" disabled={actionBusy} onClick={() => void payOnline()}>
              {actionBusy ? <span className="spinner" /> : 'Pagar online'}
            </button>
          )}

          {!confirmingCancel && (
            <button
              className="btn btn-secondary"
              disabled={actionBusy}
              onClick={() => { setConfirmingCancel(true); setActionError(null); }}
            >
              Cancelar reserva
            </button>
          )}

          {confirmingCancel && (
            <div className="confirm-cancel">
              <p>¿Confirmás cancelar esta reserva? No se puede deshacer.</p>
              <div className="row">
                <button className="btn btn-secondary" disabled={actionBusy} onClick={() => setConfirmingCancel(false)}>
                  No, volver
                </button>
                <button className="btn btn-danger" disabled={actionBusy} onClick={() => void confirmCancel()}>
                  {actionBusy ? <span className="spinner" /> : 'Sí, cancelar'}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      <a className="player-nav-link" href={`/c/${slug}`}>← Volver al club</a>
    </>
  );
}
