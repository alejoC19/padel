'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api, type CashFlowProjection, type PendingExpense,
} from '@/lib/api';
import { formatMoney, todayISO } from '@/lib/grid';
import { useSession, useToasts } from '@/hooks';
import { Toasts } from '@/components/Toasts';

/**
 * Tesorería.
 *
 * ---------------------------------------------------------------------------
 * LA PREGUNTA QUE RESPONDE
 * ---------------------------------------------------------------------------
 * "¿Me alcanza para pagar sueldos el viernes?"
 *
 * Un club puede tener la caja cuadrada y estar en problemas: cobró todo con
 * tarjeta a 18 días y tiene que pagar el alquiler el lunes. El saldo de hoy
 * no dice nada sobre eso.
 *
 * Por eso el eje de la pantalla es la proyección día por día, no el saldo
 * actual. El saldo es el punto de partida, no la respuesta.
 * ---------------------------------------------------------------------------
 */

export function TreasuryScreen() {
  const { can, isDemo } = useSession();
  const canOrDemo = useCallback(
    (permission: string) => isDemo || can(permission),
    [isDemo, can],
  );
  const { toasts, show, dismiss } = useToasts();

  const [flow, setFlow] = useState<CashFlowProjection | null>(null);
  const [expenses, setExpenses] = useState<PendingExpense[]>([]);
  const [horizon, setHorizon] = useState(30);
  const [loading, setLoading] = useState(true);
  const [demo, setDemo] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);

  const load = useCallback(async (days: number) => {
    setLoading(true);
    try {
      const [f, e] = await Promise.all([
        api.treasury.cashFlow(days),
        api.treasury.pendingExpenses(),
      ]);
      setFlow(f);
      setExpenses(e);
      setDemo(false);
    } catch {
      setDemo(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(horizon); }, [horizon, load]);

  /** Días con movimiento: mostrar 30 filas vacías no aporta nada. */
  const activeDays = useMemo(
    () => flow?.days.filter((d) => d.inflow > 0 || d.outflow > 0) ?? [],
    [flow],
  );

  const overdue = useMemo(
    () => expenses.filter((e) => e.isOverdue),
    [expenses],
  );

  if (demo) {
    return (
      <div className="screen-empty">
        <h1>Tesorería</h1>
        <p>Esta pantalla necesita el backend para funcionar.</p>
        <p className="muted">
          Flujo de fondos, gastos por vencer y saldos bancarios.
        </p>
      </div>
    );
  }

  return (
    <div className="treasury-screen">
      <header className="screen-head">
        <div>
          <h1 className="screen-title">Tesorería</h1>
          <p className="screen-sub">
            Qué plata hay y qué compromisos vienen
          </p>
        </div>
        {canOrDemo('expense.create') && (
          <div className="screen-actions">
            <button className="btn btn-primary" onClick={() => setExpenseOpen(true)}>
              Registrar gasto
            </button>
          </div>
        )}
      </header>

      {loading ? (
        <p className="card-empty">Cargando…</p>
      ) : !flow ? null : (
        <>
          {flow.alerts.length > 0 && (
            <section className="alert-stack">
              {flow.alerts.map((a, i) => (
                <div className={`alert-row is-${a.severity.toLowerCase()}`} key={i}>
                  <span className="alert-dot" aria-hidden="true" />
                  <span className="alert-msg">{a.message}</span>
                </div>
              ))}
            </section>
          )}

          <section className="totals-row">
            <TotalCard
              label="Disponible hoy"
              value={formatMoney(flow.openingBalance)}
              hint={`${formatMoney(flow.breakdown.banks)} en bancos · ${formatMoney(flow.breakdown.cashOnHand)} en caja`}
              accent
            />
            <TotalCard
              label="Por acreditar"
              value={formatMoney(flow.totals.expectedInflow)}
              hint="cobros con tarjeta pendientes"
            />
            <TotalCard
              label="Por pagar"
              value={formatMoney(flow.totals.committedOutflow)}
              hint="vencimientos del período"
              warn={flow.totals.committedOutflow > 0}
            />
            <TotalCard
              label="Saldo proyectado"
              value={formatMoney(flow.totals.projectedBalance)}
              hint={`en ${horizon} días`}
              warn={flow.totals.projectedBalance < 0}
            />
          </section>

          <div className="treasury-grid">
            <section className="panel-card">
              <header className="cart-head">
                <h2 className="card-title">Flujo de fondos</h2>
                <div className="chip-row">
                  {[15, 30, 60].map((d) => (
                    <button
                      key={d}
                      className={`chip${horizon === d ? ' is-active' : ''}`}
                      onClick={() => setHorizon(d)}
                    >
                      {d} días
                    </button>
                  ))}
                </div>
              </header>

              {activeDays.length === 0 ? (
                <p className="card-empty">
                  No hay movimientos comprometidos en los próximos {horizon} días.
                </p>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Detalle</th>
                      <th className="num">Entra</th>
                      <th className="num">Sale</th>
                      <th className="num">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeDays.map((d) => (
                      <tr key={d.date} className={d.isNegative ? 'is-negative' : ''}>
                        <td className="nowrap">{formatShortDate(d.date)}</td>
                        <td className="cell-muted">
                          {[
                            ...d.detail.settlements.map((s) => s.method),
                            ...d.detail.expenses.map((e) => e.concept),
                          ].slice(0, 2).join(', ')}
                          {d.detail.settlements.length + d.detail.expenses.length > 2 &&
                            ` +${d.detail.settlements.length + d.detail.expenses.length - 2}`}
                        </td>
                        <td className="num">
                          {d.inflow > 0 ? formatMoney(d.inflow) : '—'}
                        </td>
                        <td className="num">
                          {d.outflow > 0 ? (
                            <span className="fee">−{formatMoney(d.outflow)}</span>
                          ) : '—'}
                        </td>
                        <td className={`num strong${d.isNegative ? ' is-danger' : ''}`}>
                          {formatMoney(d.runningBalance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="panel-card">
              <h2 className="card-title">
                Gastos por pagar
                {overdue.length > 0 && (
                  <span className="tag-danger">{overdue.length} vencido{overdue.length === 1 ? '' : 's'}</span>
                )}
              </h2>

              {expenses.length === 0 ? (
                <p className="card-empty">No hay gastos pendientes.</p>
              ) : (
                <div className="expense-list">
                  {expenses.slice(0, 12).map((e) => (
                    <div className={`expense-row${e.isOverdue ? ' is-overdue' : ''}`} key={e.id}>
                      <div className="expense-main">
                        <span className="expense-concept">{e.concept}</span>
                        <span className="cell-muted">
                          {e.supplier ?? e.category ?? 'Sin proveedor'}
                          {e.dueDate && ` · ${formatDue(e.daysToDue)}`}
                        </span>
                      </div>
                      <span className="expense-amount">{formatMoney(e.total)}</span>
                      {canOrDemo('expense.approve') && (
                        <button
                          className="btn-mini"
                          disabled={payingId === e.id}
                          onClick={async () => {
                            setPayingId(e.id);
                            try {
                              const methods = await api.cash.paymentMethods();
                              const cash = methods.find((m) => m.kind === 'CASH');
                              if (!cash) {
                                show('El club no tiene medios de pago configurados.', 'error');
                                return;
                              }
                              await api.treasury.payExpense(e.id, {
                                paymentMethodId: cash.id,
                              });
                              await load(horizon);
                              show(`${e.concept} pagado.`);
                            } catch (err) {
                              const msg = err instanceof Error ? err.message : 'No se pudo pagar.';
                              show(
                                msg.includes('caja abierta')
                                  ? 'No hay una caja abierta. Abrí la caja para pagar en efectivo.'
                                  : msg,
                                'error',
                              );
                            } finally {
                              setPayingId(null);
                            }
                          }}
                        >
                          {payingId === e.id ? '…' : 'Pagar'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </>
      )}

      {expenseOpen && (
        <ExpenseDialog
          onClose={() => setExpenseOpen(false)}
          onCreated={async (concept) => {
            setExpenseOpen(false);
            await load(horizon);
            show(`${concept} quedó registrado como pendiente.`);
          }}
          onError={(m) => show(m, 'error')}
        />
      )}

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

function TotalCard({ label, value, hint, accent, warn }: {
  label: string; value: string; hint: string; accent?: boolean; warn?: boolean;
}) {
  return (
    <div className={`total-card${accent ? ' is-accent' : ''}${warn ? ' is-warn' : ''}`}>
      <span className="total-label">{label}</span>
      <span className="total-value">{value}</span>
      <span className="total-hint">{hint}</span>
    </div>
  );
}

function formatShortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return `${Number(d)} ${months[Number(m) - 1] ?? ''}`;
}

/** "Vence en 3 días" se entiende sin calcular. */
function formatDue(days: number | null): string {
  if (days === null) return 'sin vencimiento';
  if (days < 0) return `venció hace ${Math.abs(days)} día${Math.abs(days) === 1 ? '' : 's'}`;
  if (days === 0) return 'vence hoy';
  if (days === 1) return 'vence mañana';
  return `vence en ${days} días`;
}

/**
 * Alta de gasto.
 *
 * Registra la obligación, no el pago. Una factura que vence el 15 es un
 * gasto desde que llega, aunque se pague el 14: si solo se cargara al pagar,
 * la proyección de fondos nunca la vería.
 */
function ExpenseDialog({
  onClose, onCreated, onError,
}: {
  onClose: () => void;
  onCreated: (concept: string) => void;
  onError: (m: string) => void;
}) {
  const [concept, setConcept] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string }>>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setSuppliers(await api.treasury.suppliers());
      } catch {
        // Sin proveedores cargados el gasto igual se puede registrar.
      }
    })();
  }, []);

  const submit = async () => {
    if (!concept.trim()) { onError('Escribí el concepto del gasto.'); return; }
    if (!Number(amount)) { onError('Indicá el monto.'); return; }

    setBusy(true);
    try {
      await api.treasury.createExpense({
        concept: concept.trim(),
        amount: Number(amount),
        date: todayISO(),
        dueDate: dueDate || undefined,
        supplierId: supplierId || undefined,
      });
      onCreated(concept.trim());
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo registrar el gasto.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Registrar gasto">
        <h2 className="dialog-title">Registrar gasto</h2>
        <p className="dialog-sub">
          Se anota como pendiente. La plata sale cuando lo pagues.
        </p>

        <label className="field-block">
          <span className="label">Concepto</span>
          <input className="input" value={concept} autoFocus
                 placeholder="Alquiler junio, factura de luz…"
                 onChange={(e) => setConcept(e.target.value)} />
        </label>

        <div className="field-pair">
          <label className="field-block">
            <span className="label">Monto</span>
            <input className="input" type="number" inputMode="numeric"
                   value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="field-block">
            <span className="label">Vence</span>
            <input className="input" type="date"
                   value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            <span className="field-hint">Para que aparezca en la proyección.</span>
          </label>
        </div>

        {suppliers.length > 0 && (
          <label className="field-block">
            <span className="label">Proveedor</span>
            <select className="input" value={supplierId}
                    onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Sin proveedor</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
        )}

        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Registrando…' : 'Registrar'}
          </button>
        </div>
      </div>
    </div>
  );
}
