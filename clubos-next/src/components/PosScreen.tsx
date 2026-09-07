'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/grid';
import { useSession, useToasts } from '@/hooks';
import { Toasts } from '@/components/Toasts';

/**
 * Punto de venta del buffet.
 *
 * ---------------------------------------------------------------------------
 * DISEÑADO PARA UNA MANO Y POCA ATENCIÓN
 * ---------------------------------------------------------------------------
 * Quien vende una Coca está también atendiendo el teléfono y cargando un
 * turno. La pantalla tiene que funcionar con toques grandes y sin leer:
 * tocar el producto lo agrega, tocarlo de nuevo suma otra unidad.
 *
 * No hay confirmación por producto ni diálogo intermedio. El único momento
 * de confirmación es el cobro, que es donde importa.
 *
 * ---------------------------------------------------------------------------
 * EL VUELTO SE CALCULA SOLO
 * ---------------------------------------------------------------------------
 * Es la operación que más se hace mal con gente esperando. Se ingresa con
 * cuánto pagó el cliente y la pantalla muestra el vuelto en grande.
 * ---------------------------------------------------------------------------
 */

interface Product {
  id: string;
  name: string;
  salePrice: number;
  stockQty: number;
  trackStock: boolean;
  unit: string;
  kind: string;
  available: boolean;
  category: { id: string; name: string } | null;
}

interface CartLine {
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  stockQty: number;
  trackStock: boolean;
}

interface PaymentMethod {
  id: string; code: string; name: string; kind: string;
}

export function PosScreen() {
  const { can, isDemo } = useSession();
  const canOrDemo = useCallback(
    (permission: string) => isDemo || can(permission),
    [isDemo, can],
  );
  const { toasts, show, dismiss } = useToasts();

  const [products, setProducts] = useState<Product[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [demo, setDemo] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [cat, pm] = await Promise.all([
          api.pos.catalog(),
          api.cash.paymentMethods(),
        ]);
        setProducts(cat as Product[]);
        setMethods(pm.filter((m) => m.kind !== 'ACCOUNT_CREDIT'));
        setDemo(false);
      } catch {
        setDemo(true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const categories = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of products) {
      if (p.category) map.set(p.category.id, p.category.name);
    }
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [products]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter((p) => {
      if (category && p.category?.id !== category) return false;
      if (term && !p.name.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [products, category, search]);

  const total = useMemo(
    () => cart.reduce((s, l) => s + l.unitPrice * l.quantity, 0),
    [cart],
  );

  /** Tocar un producto lo agrega o suma una unidad. */
  const addToCart = useCallback((p: Product) => {
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === p.id);
      if (existing) {
        return prev.map((l) =>
          l.productId === p.id ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [...prev, {
        productId: p.id,
        name: p.name,
        unitPrice: p.salePrice,
        quantity: 1,
        stockQty: p.stockQty,
        trackStock: p.trackStock,
      }];
    });
  }, []);

  const changeQty = useCallback((productId: string, delta: number) => {
    setCart((prev) =>
      prev.flatMap((l) => {
        if (l.productId !== productId) return [l];
        const q = l.quantity + delta;
        return q <= 0 ? [] : [{ ...l, quantity: q }];
      }),
    );
  }, []);

  const clearCart = useCallback(() => setCart([]), []);

  if (loading) return <div className="screen-loading">Cargando el catálogo…</div>;

  if (demo) {
    return (
      <div className="screen-empty">
        <h1>Buffet</h1>
        <p>Esta pantalla necesita el backend para funcionar.</p>
        <p className="muted">
          Vendé bebidas y accesorios; el stock y la caja se actualizan solos.
        </p>
      </div>
    );
  }

  return (
    <div className="pos-screen">
      <div className="pos-catalog">
        <div className="pos-filters">
          <input
            className="input"
            placeholder="Buscar producto…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="chip-row">
            <button
              className={`chip${category === null ? ' is-active' : ''}`}
              onClick={() => setCategory(null)}
            >
              Todo
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                className={`chip${category === c.id ? ' is-active' : ''}`}
                onClick={() => setCategory(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>

        {visible.length === 0 ? (
          <p className="card-empty">No hay productos que coincidan.</p>
        ) : (
          <div className="product-grid">
            {visible.map((p) => (
              <button
                key={p.id}
                className={`product-tile${!p.available ? ' is-out' : ''}`}
                onClick={() => addToCart(p)}
              >
                <span className="product-name">{p.name}</span>
                <span className="product-price">{formatMoney(p.salePrice)}</span>
                {p.trackStock && (
                  <span className={`product-stock${p.stockQty <= 0 ? ' is-out' : ''}`}>
                    {p.stockQty <= 0
                      ? 'Sin stock'
                      : `${p.stockQty} ${p.unit}${p.stockQty === 1 ? '' : 's'}`}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <aside className="pos-cart">
        <header className="cart-head">
          <h2 className="card-title">Venta</h2>
          {cart.length > 0 && (
            <button className="link-btn" onClick={clearCart}>Vaciar</button>
          )}
        </header>

        {cart.length === 0 ? (
          <p className="cart-empty">
            Tocá un producto para agregarlo.
          </p>
        ) : (
          <div className="cart-lines">
            {cart.map((l) => {
              // El aviso de stock no bloquea: frenar un cobro porque el
              // inventario está desactualizado es peor negocio que el
              // descuadre.
              const short = l.trackStock && l.quantity > l.stockQty;
              return (
                <div className="cart-line" key={l.productId}>
                  <div className="cart-line-main">
                    <span className="cart-line-name">{l.name}</span>
                    <span className="cart-line-price">
                      {formatMoney(l.unitPrice)} c/u
                    </span>
                    {short && (
                      <span className="cart-line-warn">
                        Quedan {l.stockQty} en stock
                      </span>
                    )}
                  </div>
                  <div className="qty-control">
                    <button onClick={() => changeQty(l.productId, -1)} aria-label="Quitar uno">−</button>
                    <span>{l.quantity}</span>
                    <button onClick={() => changeQty(l.productId, 1)} aria-label="Agregar uno">+</button>
                  </div>
                  <span className="cart-line-total">
                    {formatMoney(l.unitPrice * l.quantity)}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <footer className="cart-foot">
          <div className="cart-total">
            <span>Total</span>
            <span className="cart-total-value">{formatMoney(total)}</span>
          </div>
          <button
            className="btn btn-primary btn-lg"
            disabled={cart.length === 0 || !canOrDemo('sale.create')}
            onClick={() => setPayOpen(true)}
          >
            Cobrar
          </button>
        </footer>
      </aside>

      {payOpen && (
        <PayDialog
          total={total}
          methods={methods}
          onCancel={() => setPayOpen(false)}
          onConfirm={async (methodId, tendered) => {
            try {
              const res = await api.pos.createSale({
                items: cart.map((l) => ({
                  productId: l.productId,
                  quantity: l.quantity,
                })),
                payment: { paymentMethodId: methodId, amount: total, tendered },
              });
              setPayOpen(false);
              clearCart();
              // Se recarga el catálogo: el stock cambió.
              const cat = await api.pos.catalog();
              setProducts(cat as Product[]);

              const change = tendered && tendered > total ? tendered - total : 0;
              show(
                change > 0
                  ? `Venta ${res.code} · vuelto ${formatMoney(change)}`
                  : `Venta ${res.code} registrada.`,
              );
              for (const w of res.warnings ?? []) show(w, 'error');
            } catch (e) {
              const msg = e instanceof Error ? e.message : 'No se pudo registrar la venta.';
              show(
                msg.includes('caja abierta')
                  ? 'No hay una caja abierta. Abrí la caja para cobrar en efectivo.'
                  : msg,
                'error',
              );
            }
          }}
        />
      )}

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

/**
 * Cobro con cálculo de vuelto.
 *
 * Los botones de monto rápido cubren los billetes con los que la gente paga.
 * Tocar uno completa el campo: es más rápido que tipear y elimina el error
 * de tipeo con gente esperando.
 */
function PayDialog({
  total, methods, onCancel, onConfirm,
}: {
  total: number;
  methods: PaymentMethod[];
  onCancel: () => void;
  onConfirm: (methodId: string, tendered?: number) => Promise<void>;
}) {
  const cashMethod = methods.find((m) => m.kind === 'CASH');
  const [methodId, setMethodId] = useState(cashMethod?.id ?? methods[0]?.id ?? '');
  const [tendered, setTendered] = useState('');
  const [busy, setBusy] = useState(false);

  const isCash = methods.find((m) => m.id === methodId)?.kind === 'CASH';
  const paid = Number(tendered) || 0;
  const change = paid > total ? paid - total : 0;
  const short = isCash && paid > 0 && paid < total;

  /** Billetes con los que la gente paga, redondeados hacia arriba. */
  const quickAmounts = useMemo(() => {
    const options = [total];
    for (const bill of [1000, 2000, 5000, 10000, 20000]) {
      const rounded = Math.ceil(total / bill) * bill;
      if (rounded > total && !options.includes(rounded)) options.push(rounded);
    }
    return options.slice(0, 4);
  }, [total]);

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Cobrar">
        <h2 className="dialog-title">Cobrar {formatMoney(total)}</h2>

        <div className="method-picker">
          {methods.map((m) => (
            <button
              key={m.id}
              className={`method-option${methodId === m.id ? ' is-active' : ''}`}
              onClick={() => setMethodId(m.id)}
            >
              {m.name}
            </button>
          ))}
        </div>

        {isCash && (
          <>
            <label className="field-block">
              <span className="label">Paga con</span>
              <input
                className="input is-large"
                type="number"
                inputMode="numeric"
                value={tendered}
                onChange={(e) => setTendered(e.target.value)}
                autoFocus
              />
              {short && (
                <span className="field-error">
                  Falta {formatMoney(total - paid)}.
                </span>
              )}
            </label>

            <div className="quick-amounts">
              {quickAmounts.map((a) => (
                <button
                  key={a}
                  className="quick-amount"
                  onClick={() => setTendered(String(a))}
                >
                  {a === total ? 'Justo' : formatMoney(a)}
                </button>
              ))}
            </div>

            {change > 0 && (
              <div className="change-box">
                <span className="change-label">Vuelto</span>
                <span className="change-value">{formatMoney(change)}</span>
              </div>
            )}
          </>
        )}

        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || !methodId || short}
            onClick={async () => {
              setBusy(true);
              await onConfirm(methodId, isCash && paid > 0 ? paid : undefined);
              setBusy(false);
            }}
          >
            {busy ? 'Cobrando…' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
}
