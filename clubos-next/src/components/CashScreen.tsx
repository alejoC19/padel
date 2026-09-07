'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/grid';
import { useSession, useToasts } from '@/hooks';
import { Toasts } from '@/components/Toasts';
import { DENOMINATIONS, CountDialog } from '@/components/CountDialog';

/**
 * Caja.
 *
 * ---------------------------------------------------------------------------
 * LA DISTINCIÓN QUE DEFINE LA PANTALLA
 * ---------------------------------------------------------------------------
 * Una caja registra todos los medios de pago, pero el arqueo cuenta solo
 * billetes. Por eso el número grande es el **efectivo esperado**, no el
 * total cobrado: es lo único que el recepcionista puede verificar contando.
 *
 * Si se mostrara el total, contaría $51.500 en el cajón contra un esperado
 * de $181.500 y aparecería un faltante de $130.000 que no existe.
 * ---------------------------------------------------------------------------
 */

interface CashBalance {
  sessionId: string;
  status: string;
  registerName: string;
  operatorName: string | null;
  openedAt: string;
  openingAmount: number;
  expectedCash: number;
  cashInflow: number;
  cashOutflow: number;
  totalInflow: number;
  totalOutflow: number;
  movementCount: number;
  byMethod: Array<{
    code: string; name: string; inflow: number; outflow: number;
    net: number; affectsCashCount: boolean;
  }>;
  byType: Array<{ type: string; inflow: number; outflow: number; count: number }>;
}

interface Register { id: string; name: string }

const TYPE_LABEL: Record<string, string> = {
  BOOKING_PAYMENT: 'Turnos',
  PRODUCT_SALE: 'Buffet',
  LESSON_PAYMENT: 'Clases',
  MEMBERSHIP_PAYMENT: 'Membresías',
  TOURNAMENT_FEE: 'Torneos',
  MANUAL_INCOME: 'Ingresos varios',
  EXPENSE: 'Gastos',
  WITHDRAWAL: 'Retiros',
  DEPOSIT: 'Depósitos',
  REFUND: 'Devoluciones',
  ADJUSTMENT: 'Ajustes',
};

const MOVEMENT_TYPES = [
  { value: 'MANUAL_INCOME', label: 'Ingreso', direction: 'IN' },
  { value: 'EXPENSE', label: 'Gasto', direction: 'OUT' },
  { value: 'WITHDRAWAL', label: 'Retiro', direction: 'OUT' },
  { value: 'DEPOSIT', label: 'Depósito', direction: 'IN' },
];

export function CashScreen() {
  const { can, isDemo } = useSession();
  // En modo demo (sin sesión) se muestran todas las acciones — es la
  // vidriera de venta, no depende de permisos reales. Con sesión, el
  // permiso real manda.
  const canOrDemo = useCallback(
    (permission: string) => isDemo || can(permission),
    [isDemo, can],
  );
  const { toasts, show, dismiss } = useToasts();

  const [balance, setBalance] = useState<CashBalance | null>(null);
  const [registers, setRegisters] = useState<Register[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [movementOpen, setMovementOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [demo, setDemo] = useState(false);

  const load = useCallback(async () => {
    try {
      const mine = await api.cash.mine();
      setBalance(mine as CashBalance | null);
      setDemo(false);
    } catch {
      // Sin backend: la pantalla se muestra igual pero avisa.
      setDemo(true);
      setBalance(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openSession = useCallback(async (registerId: string, amount: number) => {
    setBusy(true);
    try {
      await api.cash.open(registerId, amount);
      await load();
      show('Caja abierta. Ya podés cobrar en efectivo.');
    } catch (e) {
      show(e instanceof Error ? e.message : 'No se pudo abrir la caja.', 'error');
    } finally {
      setBusy(false);
    }
  }, [load, show]);

  if (loading) return <div className="screen-loading">Cargando la caja…</div>;

  if (demo) {
    return (
      <div className="screen-empty">
        <h1>Caja</h1>
        <p>Esta pantalla necesita el backend para funcionar.</p>
        <p className="muted">
          Abrí turno, registrá movimientos, arqueá y cerrá el día.
        </p>
      </div>
    );
  }

  if (!balance) {
    return (
      <>
        <OpenSessionForm
          registers={registers}
          busy={busy}
          onLoadRegisters={setRegisters}
          onOpen={openSession}
          onError={(m) => show(m, 'error')}
        />
        <Toasts toasts={toasts} onDismiss={dismiss} />
      </>
    );
  }

  const closed = balance.status !== 'OPEN';

  return (
    <div className="cash-screen">
      <header className="screen-head">
        <div>
          <h1 className="screen-title">{balance.registerName}</h1>
          <p className="screen-sub">
            Abierta {new Date(balance.openedAt).toLocaleString('es-AR', {
              day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
            })}
            {balance.operatorName && ` · ${balance.operatorName}`}
          </p>
        </div>
        <div className="screen-actions">
          {!closed && canOrDemo('cash.movement') && (
            <button className="btn btn-secondary" onClick={() => setMovementOpen(true)}>
              Registrar movimiento
            </button>
          )}
          {!closed && canOrDemo('cash.close') && (
            <button className="btn btn-primary" onClick={() => setCloseOpen(true)}>
              Cerrar caja
            </button>
          )}
        </div>
      </header>

      {/* El número que importa: lo que tiene que haber en billetes. */}
      <section className="cash-hero">
        <div className="cash-hero-main">
          <span className="cash-hero-label">Efectivo esperado en el cajón</span>
          <span className="cash-hero-value">{formatMoney(balance.expectedCash)}</span>
          <span className="cash-hero-hint">
            Apertura {formatMoney(balance.openingAmount)} · entró{' '}
            {formatMoney(balance.cashInflow)} · salió {formatMoney(balance.cashOutflow)}
          </span>
        </div>
        <div className="cash-hero-side">
          <Metric label="Cobrado (todos los medios)" value={formatMoney(balance.totalInflow)} />
          <Metric label="Salidas" value={formatMoney(balance.totalOutflow)} />
          <Metric label="Movimientos" value={String(balance.movementCount)} />
        </div>
      </section>

      <div className="cash-grid">
        <section className="panel-card">
          <h2 className="card-title">Por medio de pago</h2>
          {balance.byMethod.length === 0 ? (
            <p className="card-empty">Todavía no hubo cobros en este turno.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Medio</th>
                  <th className="num">Entró</th>
                  <th className="num">Salió</th>
                  <th className="num">Neto</th>
                </tr>
              </thead>
              <tbody>
                {balance.byMethod.map((m) => (
                  <tr key={m.code}>
                    <td>
                      {m.name}
                      {/* Se marca lo que NO se cuenta en el arqueo, porque es
                          la causa número uno de un faltante inexistente. */}
                      {!m.affectsCashCount && (
                        <span className="tag-muted">no cuenta en el arqueo</span>
                      )}
                    </td>
                    <td className="num">{m.inflow > 0 ? formatMoney(m.inflow) : '—'}</td>
                    <td className="num">{m.outflow > 0 ? formatMoney(m.outflow) : '—'}</td>
                    <td className="num strong">{formatMoney(m.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="panel-card">
          <h2 className="card-title">Por concepto</h2>
          {balance.byType.length === 0 ? (
            <p className="card-empty">Sin movimientos.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Concepto</th>
                  <th className="num">Cant.</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {balance.byType.map((t) => (
                  <tr key={t.type}>
                    <td>{TYPE_LABEL[t.type] ?? t.type}</td>
                    <td className="num">{t.count}</td>
                    <td className="num strong">
                      {t.inflow > 0 ? formatMoney(t.inflow) : `−${formatMoney(t.outflow)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {movementOpen && (
        <MovementDialog
          sessionId={balance.sessionId}
          available={balance.expectedCash}
          can={canOrDemo}
          onClose={() => setMovementOpen(false)}
          onDone={async (msg) => {
            setMovementOpen(false);
            await load();
            show(msg);
          }}
          onError={(m) => show(m, 'error')}
        />
      )}

      {closeOpen && (
        <CountDialog
          expectedCash={balance.expectedCash}
          onCancel={() => setCloseOpen(false)}
          onConfirm={async (counted, denominations, reason) => {
            setBusy(true);
            try {
              const res = await api.cash.close(balance.sessionId, {
                countedCash: counted,
                denominations,
                differenceReason: reason,
              });
              setCloseOpen(false);
              await load();
              show(
                res.difference === 0
                  ? 'Caja cerrada. El arqueo cuadró.'
                  : `Caja cerrada con ${res.difference < 0 ? 'faltante' : 'sobrante'} de ${formatMoney(Math.abs(res.difference))}.`,
                res.difference === 0 ? 'ok' : 'error',
              );
            } catch (e) {
              show(e instanceof Error ? e.message : 'No se pudo cerrar la caja.', 'error');
            } finally {
              setBusy(false);
            }
          }}
          busy={busy}
        />
      )}

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
    </div>
  );
}

/** Apertura de turno. */
function OpenSessionForm({
  registers, busy, onLoadRegisters, onOpen, onError,
}: {
  registers: Register[];
  busy: boolean;
  onLoadRegisters: (r: Register[]) => void;
  onOpen: (registerId: string, amount: number) => void;
  onError: (m: string) => void;
}) {
  const [registerId, setRegisterId] = useState('');
  const [amount, setAmount] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const list = await api.cash.registers();
        onLoadRegisters(list);
        if (list.length === 1 && list[0]) setRegisterId(list[0].id);
      } catch {
        onError('No se pudieron cargar los puestos de caja.');
      }
    })();
    // Solo al montar: recargar la lista en cada render dispararía un bucle.
  }, []);

  return (
    <div className="screen-empty">
      <h1>Abrir caja</h1>
      <p>No tenés un turno abierto. Abrí la caja para poder cobrar en efectivo.</p>

      <div className="open-form">
        {registers.length > 1 && (
          <label className="field-block">
            <span className="label">Puesto</span>
            <select
              className="input"
              value={registerId}
              onChange={(e) => setRegisterId(e.target.value)}
            >
              <option value="">Elegí un puesto…</option>
              {registers.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </label>
        )}

        <label className="field-block">
          <span className="label">Fondo inicial</span>
          <input
            className="input"
            type="number"
            inputMode="numeric"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <span className="field-hint">
            Lo que hay en el cajón antes de empezar, para dar vuelto.
          </span>
        </label>

        <button
          className="btn btn-primary"
          disabled={busy || !registerId}
          onClick={() => onOpen(registerId, Number(amount) || 0)}
        >
          {busy ? 'Abriendo…' : 'Abrir caja'}
        </button>
      </div>
    </div>
  );
}

/** Movimiento manual: ingreso, gasto, retiro o depósito. */
function MovementDialog({
  sessionId, available, can, onClose, onDone, onError,
}: {
  sessionId: string;
  available: number;
  can: (p: string) => boolean;
  onClose: () => void;
  onDone: (message: string) => void;
  onError: (m: string) => void;
}) {
  const [type, setType] = useState('EXPENSE');
  const [amount, setAmount] = useState('');
  const [concept, setConcept] = useState('');
  const [busy, setBusy] = useState(false);

  // Retiros y ajustes tienen permiso propio: mover plata fuera del club no
  // es lo mismo que anotar la compra de hielo.
  const types = MOVEMENT_TYPES.filter(
    (t) => t.value !== 'WITHDRAWAL' || can('cash.withdrawal'),
  );

  const selected = types.find((t) => t.value === type);
  const isOut = selected?.direction === 'OUT';
  const exceeds = isOut && Number(amount) > available;

  const submit = async () => {
    if (!concept.trim()) { onError('Escribí un concepto.'); return; }
    if (!Number(amount)) { onError('Indicá el monto.'); return; }

    setBusy(true);
    try {
      await api.cash.addMovement(sessionId, {
        type, amount: Number(amount), concept: concept.trim(),
      });
      onDone(`${selected?.label} registrado.`);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo registrar el movimiento.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Registrar movimiento">
        <h2 className="dialog-title">Registrar movimiento</h2>

        <div className="type-picker">
          {types.map((t) => (
            <button
              key={t.value}
              className={`type-option${type === t.value ? ' is-active' : ''}`}
              onClick={() => setType(t.value)}
            >
              <span className={`type-arrow${t.direction === 'IN' ? ' is-in' : ' is-out'}`}>
                {t.direction === 'IN' ? '↓' : '↑'}
              </span>
              {t.label}
            </button>
          ))}
        </div>

        <label className="field-block">
          <span className="label">Monto</span>
          <input
            className="input"
            type="number"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
          />
          {exceeds && (
            <span className="field-error">
              No hay tanto efectivo en caja. Disponible: {formatMoney(available)}.
            </span>
          )}
        </label>

        <label className="field-block">
          <span className="label">Concepto</span>
          <input
            className="input"
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
            placeholder="Compra de hielo, retiro a banco…"
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          />
        </label>

        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button
            className="btn btn-primary"
            disabled={busy || exceeds}
            onClick={() => void submit()}
          >
            {busy ? 'Registrando…' : 'Registrar'}
          </button>
        </div>
      </div>
    </div>
  );
}

export { DENOMINATIONS };
