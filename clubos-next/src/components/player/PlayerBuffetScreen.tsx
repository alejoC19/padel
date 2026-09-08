'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError } from '@/lib/api';
import { publicApi, type PublicProduct } from '@/lib/publicApi';
import { formatMoney } from '@/lib/grid';

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; productos: PublicProduct[] };

/**
 * Menú del buffet: solo ver qué hay y cuánto sale. No hay carrito ni pago
 * acá — el jugador pide y paga en el mostrador, esto es la carta digital
 * (a propósito, ver la decisión de scope de la app del jugador).
 */
export function PlayerBuffetScreen({ slug }: { slug: string }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  const fetchMenu = useCallback(async () => {
    setLoad({ status: 'loading' });
    try {
      const { productos } = await publicApi.menu(slug);
      setLoad({ status: 'ready', productos });
    } catch (e) {
      const message = e instanceof ApiError
        ? e.message
        : 'No pudimos cargar el buffet. Probá de nuevo en un momento.';
      setLoad({ status: 'error', message });
    }
  }, [slug]);

  useEffect(() => { void fetchMenu(); }, [fetchMenu]);

  const grouped = useMemo(() => {
    if (load.status !== 'ready') return [];
    const byCategory = new Map<string, PublicProduct[]>();
    for (const p of load.productos) {
      const list = byCategory.get(p.category) ?? [];
      list.push(p);
      byCategory.set(p.category, list);
    }
    return Array.from(byCategory.entries());
  }, [load]);

  if (load.status === 'loading') {
    return (
      <div className="player-state">
        <div className="spinner" />
        <p>Cargando el buffet…</p>
      </div>
    );
  }

  if (load.status === 'error') {
    return (
      <div className="player-state">
        <div className="state-icon">⚠️</div>
        <h2>Algo salió mal</h2>
        <p>{load.message}</p>
        <button className="btn btn-primary" onClick={() => void fetchMenu()}>Reintentar</button>
      </div>
    );
  }

  return (
    <>
      <header className="player-header">
        <div className="player-eyebrow">Buffet</div>
        <h1 className="player-club-name">Carta</h1>
        <p className="player-tagline">Pedí y pagá en el mostrador del club.</p>
      </header>

      {grouped.length === 0 && (
        <div className="player-state" style={{ minHeight: 'auto', padding: '32px 16px' }}>
          <div className="state-icon">🥤</div>
          <p>El club todavía no cargó el menú del buffet.</p>
        </div>
      )}

      {grouped.map(([category, products]) => (
        <section className="card" key={category}>
          <div className="menu-category">{category}</div>
          {products.map((p) => (
            <div className="menu-item" key={p.id}>
              <div className="menu-item-main">
                <span className="menu-item-name">{p.name}</span>
                {p.description && <span className="menu-item-desc">{p.description}</span>}
              </div>
              <span className="menu-item-price">{formatMoney(p.price)}</span>
            </div>
          ))}
        </section>
      ))}
    </>
  );
}
