'use client';

import { useMemo, useState } from 'react';
import { formatMoney } from '@/lib/grid';

/**
 * Arqueo de caja.
 *
 * ---------------------------------------------------------------------------
 * SE CUENTA POR DENOMINACIÓN, NO SE TIPEA UN TOTAL
 * ---------------------------------------------------------------------------
 * El recepcionista cuenta billetes, no calcula sumas. Pedirle el total lo
 * obliga a hacer la cuenta mentalmente con el cajón abierto y gente
 * esperando — que es exactamente donde aparece el error.
 *
 * Contar por denominación además deja registro de la composición del cajón:
 * cuando aparece una diferencia, saber que faltaban tres billetes de $10.000
 * y no cuarenta de $500 cambia por completo qué se investiga.
 *
 * El total tipeado queda disponible como salida rápida para cajas chicas,
 * pero el detalle es el camino por defecto.
 * ---------------------------------------------------------------------------
 */

/** Billetes y monedas argentinos en circulación. */
export const DENOMINATIONS = [
  20000, 10000, 2000, 1000, 500, 200, 100, 50, 20, 10,
] as const;

interface Props {
  expectedCash: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (
    counted: number,
    denominations: Record<string, number> | undefined,
    reason: string | undefined,
  ) => void;
}

export function CountDialog({ expectedCash, busy, onCancel, onConfirm }: Props) {
  const [mode, setMode] = useState<'detail' | 'total'>('detail');
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [typedTotal, setTypedTotal] = useState('');
  const [reason, setReason] = useState('');

  const counted = useMemo(() => {
    if (mode === 'total') return Number(typedTotal) || 0;
    return DENOMINATIONS.reduce(
      (sum, d) => sum + d * (Number(counts[d]) || 0),
      0,
    );
  }, [mode, counts, typedTotal]);

  const difference = Math.round((counted - expectedCash) * 100) / 100;
  const needsReason = difference !== 0;
  const canConfirm = !busy && (!needsReason || reason.trim().length > 0);

  const totalBills = useMemo(
    () => DENOMINATIONS.reduce((n, d) => n + (Number(counts[d]) || 0), 0),
    [counts],
  );

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="dialog is-wide" role="dialog" aria-modal="true" aria-label="Cerrar caja">
        <h2 className="dialog-title">Cerrar caja</h2>
        <p className="dialog-sub">
          Contá el efectivo del cajón. El sistema calcula la diferencia.
        </p>

        <div className="mode-switch">
          <button
            className={`mode-option${mode === 'detail' ? ' is-active' : ''}`}
            onClick={() => setMode('detail')}
          >
            Contar billetes
          </button>
          <button
            className={`mode-option${mode === 'total' ? ' is-active' : ''}`}
            onClick={() => setMode('total')}
          >
            Escribir el total
          </button>
        </div>

        {mode === 'detail' ? (
          <div className="denom-grid">
            {DENOMINATIONS.map((d) => {
              const qty = Number(counts[d]) || 0;
              return (
                <label className="denom-row" key={d}>
                  <span className="denom-value">{formatMoney(d)}</span>
                  <input
                    className="denom-input"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    placeholder="0"
                    value={counts[d] ?? ''}
                    onChange={(e) =>
                      setCounts((prev) => ({ ...prev, [d]: e.target.value }))
                    }
                  />
                  <span className="denom-subtotal">
                    {qty > 0 ? formatMoney(d * qty) : ''}
                  </span>
                </label>
              );
            })}
            {totalBills > 0 && (
              <p className="denom-count">{totalBills} billetes contados</p>
            )}
          </div>
        ) : (
          <label className="field-block">
            <span className="label">Total contado</span>
            <input
              className="input is-large"
              type="number"
              inputMode="numeric"
              value={typedTotal}
              onChange={(e) => setTypedTotal(e.target.value)}
              autoFocus
            />
          </label>
        )}

        <div className="arqueo-summary">
          <div className="arqueo-row">
            <span>Esperado</span>
            <span className="num">{formatMoney(expectedCash)}</span>
          </div>
          <div className="arqueo-row">
            <span>Contado</span>
            <span className="num">{formatMoney(counted)}</span>
          </div>
          <div className={`arqueo-row is-total${difference !== 0 ? ' is-off' : ''}`}>
            <span>
              {difference === 0 ? 'Cuadra' : difference < 0 ? 'Faltante' : 'Sobrante'}
            </span>
            <span className="num">
              {difference === 0 ? '—' : formatMoney(Math.abs(difference))}
            </span>
          </div>
        </div>

        {needsReason && (
          <label className="field-block">
            <span className="label">
              Motivo de la diferencia <span className="required">obligatorio</span>
            </span>
            <input
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                difference < 0
                  ? 'Vuelto mal dado, gasto sin registrar…'
                  : 'Cobro sin registrar, vuelto no entregado…'
              }
              autoFocus
            />
            {difference > 0 && (
              // Un sobrante suele ser una venta que no se asentó, que
              // contablemente es peor que un faltante.
              <span className="field-hint">
                Un sobrante casi siempre es un cobro que no se registró.
                Revisalo antes de cerrar.
              </span>
            )}
          </label>
        )}

        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
          <button
            className="btn btn-primary"
            disabled={!canConfirm}
            onClick={() =>
              onConfirm(
                counted,
                mode === 'detail'
                  ? Object.fromEntries(
                      DENOMINATIONS
                        .filter((d) => Number(counts[d]) > 0)
                        .map((d) => [String(d), Number(counts[d])]),
                    )
                  : undefined,
                needsReason ? reason.trim() : undefined,
              )
            }
          >
            {busy ? 'Cerrando…' : 'Cerrar caja'}
          </button>
        </div>
      </div>
    </div>
  );
}
