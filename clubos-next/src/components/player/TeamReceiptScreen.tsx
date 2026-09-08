'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ApiError } from '@/lib/api';
import { publicApi, type PublicTeamDetail } from '@/lib/publicApi';
import { getPublicTeam } from '@/lib/publicStorage';
import { formatLocalDate, formatMinute, formatMoney } from '@/lib/grid';

type Load =
  | { status: 'loading' }
  | { status: 'no-token' }
  | { status: 'not-found' }
  | { status: 'error'; message: string }
  | { status: 'ready'; detail: PublicTeamDetail };

const PAYMENT_LABEL: Record<string, string> = {
  PAID: 'Pagada',
  PARTIAL: 'Pago parcial',
  UNPAID: 'Pendiente de pago',
};

/** Comprobante de la inscripción de un equipo: mismo patrón que BookingReceiptScreen. */
export function TeamReceiptScreen({ slug, teamId }: { slug: string; teamId: string }) {
  const searchParams = useSearchParams();
  const urlToken = searchParams.get('token');

  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [checkoutInfo, setCheckoutInfo] = useState<string | null>(null);
  const [copyOk, setCopyOk] = useState(false);

  const [effectiveToken, setEffectiveToken] = useState<string | null>(null);
  const [tokenResolved, setTokenResolved] = useState(false);
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    setOrigin(window.location.origin);
    setEffectiveToken(urlToken ?? getPublicTeam(slug, teamId)?.accessToken ?? null);
    setTokenResolved(true);
  }, [urlToken, slug, teamId]);

  const load1 = useCallback(async () => {
    if (!tokenResolved) return;
    setLoad({ status: 'loading' });
    if (!effectiveToken) {
      setLoad({ status: 'no-token' });
      return;
    }
    try {
      const detail = await publicApi.equipoDetalle(slug, teamId, effectiveToken);
      setLoad({ status: 'ready', detail });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setLoad({ status: 'not-found' });
      } else {
        const message = e instanceof ApiError
          ? e.message
          : 'No pudimos cargar la inscripción. Probá de nuevo en un momento.';
        setLoad({ status: 'error', message });
      }
    }
  }, [slug, teamId, effectiveToken, tokenResolved]);

  useEffect(() => { void load1(); }, [load1]);

  const receiptUrl = effectiveToken && origin
    ? `${origin}/c/${slug}/equipos/${teamId}?token=${encodeURIComponent(effectiveToken)}`
    : '';

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(receiptUrl);
      setCopyOk(true);
      setTimeout(() => setCopyOk(false), 2000);
    } catch {
      /* el input queda seleccionable igual para copiar a mano */
    }
  }, [receiptUrl]);

  const payOnline = useCallback(async () => {
    if (!effectiveToken) return;
    setActionBusy(true);
    setActionError(null);
    setCheckoutInfo(null);
    try {
      const { initPoint } = await publicApi.checkoutInscripcion(slug, teamId, effectiveToken);
      window.location.href = initPoint;
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) {
        setCheckoutInfo(e.message);
      } else {
        setActionError(
          e instanceof ApiError ? e.message : 'No pudimos iniciar el pago. Probá de nuevo.',
        );
      }
    } finally {
      setActionBusy(false);
    }
  }, [slug, teamId, effectiveToken]);

  if (load.status === 'loading') {
    return (
      <div className="player-state">
        <div className="spinner" />
        <p>Cargando tu inscripción…</p>
      </div>
    );
  }

  if (load.status === 'no-token') {
    return (
      <div className="player-state">
        <div className="state-icon">🔒</div>
        <h2>No encontramos esta inscripción en este dispositivo</h2>
        <p>Usá el link que te dimos al anotar el equipo — es tu comprobante único.</p>
        <a className="btn btn-secondary" href={`/c/${slug}/torneos`}>Ver torneos</a>
      </div>
    );
  }

  if (load.status === 'not-found') {
    return (
      <div className="player-state">
        <div className="state-icon">🔎</div>
        <h2>Inscripción no encontrada</h2>
        <p>El link puede estar incompleto o el equipo no existe.</p>
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

  return (
    <>
      <header className="player-header">
        <div className="player-eyebrow">Comprobante</div>
        <div className="receipt-code">{detail.name}</div>
      </header>

      <section className="card">
        <div className="receipt-row">
          <span className="receipt-k">Torneo</span>
          <span className="receipt-v">{detail.tournamentName}</span>
        </div>
        <div className="receipt-row">
          <span className="receipt-k">Fecha</span>
          <span className="receipt-v">
            {formatLocalDate(detail.tournamentStartsAt.slice(0, 10))} ·{' '}
            {formatMinute(
              new Date(detail.tournamentStartsAt).getHours() * 60 +
              new Date(detail.tournamentStartsAt).getMinutes(),
            )} hs
          </span>
        </div>
        <div className="receipt-row">
          <span className="receipt-k">Jugadores</span>
          <span className="receipt-v">{detail.players.join(', ')}</span>
        </div>
        <div className="receipt-row">
          <span className="receipt-k">Inscripción</span>
          <span className="receipt-v">{formatMoney(detail.entryFee)}</span>
        </div>
        <div className="receipt-row">
          <span className="receipt-k">Pago</span>
          <span className={`badge ${detail.paymentStatus === 'PAID' ? 'success' : 'warning'}`}>
            {PAYMENT_LABEL[detail.paymentStatus] ?? detail.paymentStatus}
          </span>
        </div>
      </section>

      <section>
        <div className="player-section-title">Guardá este link</div>
        <p className="field-hint" style={{ marginBottom: 8 }}>
          Es tu comprobante: te deja ver el estado y pagar la inscripción más adelante.
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

      {detail.paymentStatus !== 'PAID' && detail.entryFee > 0 && (
        <section className="receipt-actions">
          <button className="btn btn-primary" disabled={actionBusy} onClick={() => void payOnline()}>
            {actionBusy ? <span className="spinner" /> : 'Pagar inscripción online'}
          </button>
        </section>
      )}

      <a className="player-nav-link" href={`/c/${slug}/torneos`}>← Volver a torneos</a>
    </>
  );
}
