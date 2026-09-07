'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type DailyClose } from '@/lib/api';
import { addDays, formatLocalDate, formatMoney, isToday, todayISO } from '@/lib/grid';
import { useToasts } from '@/hooks';
import { Toasts } from '@/components/Toasts';

/**
 * Cierre de día.
 *
 * ---------------------------------------------------------------------------
 * TRES CIFRAS, NO UNA
 * ---------------------------------------------------------------------------
 * Facturado (lo vendido), cobrado (lo que entró) y pendiente (lo que falta).
 * Mostrar solo "ingresos" es cómo un club cree que tuvo un buen día y a fin
 * de mes no le cierra la plata.
 *
 * Las alertas van arriba de todo: son las cosas que hay que resolver, y un
 * reporte que solo muestra números obliga a interpretarlos.
 * ---------------------------------------------------------------------------
 */


export function ReportsScreen() {
  const { toasts, show, dismiss } = useToasts();
  const [date, setDate] = useState(todayISO());
  const [data, setData] = useState<DailyClose | null>(null);
  const [loading, setLoading] = useState(true);
  const [demo, setDemo] = useState(false);

  const load = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const res = await api.reports.dailyClose(d);
      setData(res);
      setDemo(false);
    } catch (e) {
      setDemo(true);
      if (e instanceof Error && !e.message.includes('fetch')) {
        show(e.message, 'error');
      }
    } finally {
      setLoading(false);
    }
  }, [show]);

  useEffect(() => { void load(date); }, [date, load]);

  if (demo) {
    return (
      <div className="screen-empty">
        <h1>Reportes</h1>
        <p>Esta pantalla necesita el backend para funcionar.</p>
        <p className="muted">
          Cómo fue el día: turnos, buffet, cajas y lo que quedó por cobrar.
        </p>
      </div>
    );
  }

  return (
    <div className="reports-screen">
      <header className="screen-head">
        <div>
          <h1 className="screen-title">Cierre de día</h1>
          <p className="screen-sub">
            {formatLocalDate(date)}
            {isToday(date) && <span className="date-relative">Hoy</span>}
          </p>
        </div>
        <div className="screen-actions">
          <div className="date-nav">
            <button className="nav-btn" onClick={() => setDate(addDays(date, -1))}
                    aria-label="Día anterior">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
            <button className="nav-btn" onClick={() => setDate(addDays(date, 1))}
                    disabled={isToday(date)} aria-label="Día siguiente">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6" /></svg>
            </button>
            <button className="today-btn" onClick={() => setDate(todayISO())}>Hoy</button>
          </div>
        </div>
      </header>

      {loading ? (
        <p className="card-empty">Cargando…</p>
      ) : !data ? null : (
        <>
          {/* Las alertas primero: son tareas, no números. */}
          {data.alerts.length > 0 && (
            <section className="alert-stack">
              {data.alerts.map((a, i) => (
                <div className={`alert-row is-${a.severity.toLowerCase()}`} key={i}>
                  <span className="alert-dot" aria-hidden="true" />
                  <div>
                    <span className="alert-msg">{a.message}</span>
                    {a.action && <span className="alert-action">{a.action}</span>}
                  </div>
                </div>
              ))}
            </section>
          )}

          {/* Las tres cifras que se confunden. */}
          <section className="totals-row">
            <TotalCard
              label="Facturado"
              value={formatMoney(data.totals.billed)}
              hint="lo que se vendió hoy"
            />
            <TotalCard
              label="Cobrado"
              value={formatMoney(data.totals.collected)}
              hint="lo que efectivamente entró"
              accent
            />
            <TotalCard
              label="Por cobrar"
              value={data.totals.pending > 0 ? formatMoney(data.totals.pending) : '—'}
              hint="quedó pendiente"
              warn={data.totals.pending > 0}
            />
            <TotalCard
              label="Neto"
              value={formatMoney(data.totals.net)}
              hint="cobrado menos salidas y comisiones"
            />
          </section>

          <div className="reports-grid">
            <section className="panel-card">
              <h2 className="card-title">Turnos</h2>
              <div className="stat-grid">
                <StatBox label="Jugados" value={String(data.bookings.played)} />
                <StatBox label="Ocupación"
                         value={`${Math.round(data.bookings.occupancyPercent)}%`} />
                <StatBox label="Cancelados" value={String(data.bookings.cancelled)}
                         warn={data.bookings.cancelled >= 3} />
                <StatBox label="No vinieron" value={String(data.bookings.noShow)}
                         warn={data.bookings.noShow >= 2} />
              </div>
              <dl className="field-group compact">
                <Field label="Facturado" value={formatMoney(data.bookings.billed)} />
                <Field label="Cobrado" value={formatMoney(data.bookings.collected)} />
                {data.bookings.pending > 0 && (
                  <Field label="Pendiente"
                         value={formatMoney(data.bookings.pending)} warn />
                )}
              </dl>
            </section>

            <section className="panel-card">
              <h2 className="card-title">Buffet</h2>
              {data.buffet.sales === 0 ? (
                <p className="card-empty">No hubo ventas.</p>
              ) : (
                <>
                  <div className="stat-grid">
                    <StatBox label="Ventas" value={String(data.buffet.sales)} />
                    <StatBox label="Facturado" value={formatMoney(data.buffet.billed)} />
                    <StatBox label="Ganancia"
                             value={formatMoney(data.buffet.grossProfit)} />
                    {data.buffet.marginPercent !== null && (
                      <StatBox label="Margen"
                               value={`${Math.round(data.buffet.marginPercent)}%`} />
                    )}
                  </div>
                  {data.buffet.topProducts.length > 0 && (
                    <table className="data-table compact">
                      <tbody>
                        {data.buffet.topProducts.slice(0, 5).map((p) => (
                          <tr key={p.name}>
                            <td>{p.name}</td>
                            <td className="num cell-muted">{p.quantity}</td>
                            <td className="num strong">{formatMoney(p.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}
            </section>

            <section className="panel-card is-wide">
              <h2 className="card-title">Cómo cobraron</h2>
              {data.byPaymentMethod.length === 0 ? (
                <p className="card-empty">No hubo cobros.</p>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Medio</th>
                      <th className="num">Ops.</th>
                      <th className="num">Bruto</th>
                      <th className="num">Comisión</th>
                      <th className="num">Neto</th>
                      <th>Acredita</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byPaymentMethod.map((m) => (
                      <tr key={m.code}>
                        <td>{m.name}</td>
                        <td className="num cell-muted">{m.count}</td>
                        <td className="num">{formatMoney(m.amount)}</td>
                        <td className="num">
                          {m.fees > 0 ? (
                            <span className="fee">−{formatMoney(m.fees)}</span>
                          ) : '—'}
                        </td>
                        <td className="num strong">{formatMoney(m.net)}</td>
                        <td className="cell-muted">
                          {/* Cobrar con crédito no es tener la plata: entra
                              el neto y a los 18 días. */}
                          {m.settlesInDays === 0
                            ? 'En el acto'
                            : `En ${m.settlesInDays} día${m.settlesInDays === 1 ? '' : 's'}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="panel-card is-wide">
              <h2 className="card-title">Cajas</h2>
              {data.cashSessions.length === 0 ? (
                <p className="card-empty">No se abrió ninguna caja.</p>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Puesto</th>
                      <th>Responsable</th>
                      <th className="num">Esperado</th>
                      <th className="num">Contado</th>
                      <th className="num">Diferencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.cashSessions.map((s) => (
                      <tr key={s.id}>
                        <td>
                          {s.register}
                          {s.status === 'OPEN' && (
                            <span className="tag-muted">sin cerrar</span>
                          )}
                        </td>
                        <td className="cell-muted">{s.operator ?? '—'}</td>
                        <td className="num">
                          {s.expectedAmount !== null ? formatMoney(s.expectedAmount) : '—'}
                        </td>
                        <td className="num">
                          {s.countedAmount !== null ? formatMoney(s.countedAmount) : '—'}
                        </td>
                        <td className="num">
                          {s.difference === null ? '—'
                            : s.difference === 0 ? <span className="ok">Cuadra</span>
                            : (
                              <span className="balance-owed" title={s.differenceReason ?? ''}>
                                {s.difference < 0 ? '−' : '+'}
                                {formatMoney(Math.abs(s.difference))}
                              </span>
                            )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        </>
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

function StatBox({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="stat-box">
      <span className="stat-box-label">{label}</span>
      <span className={`stat-box-value${warn ? ' is-warn' : ''}`}>{value}</span>
    </div>
  );
}

function Field({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="field">
      <dt className="field-label">{label}</dt>
      <dd className={`field-value${warn ? ' is-warn' : ''}`}>{value}</dd>
    </div>
  );
}
