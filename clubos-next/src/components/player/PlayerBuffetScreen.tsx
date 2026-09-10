'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError } from '@/lib/api';
import { publicApi, type PublicProduct } from '@/lib/publicApi';
import { formatMoney } from '@/lib/grid';
import { CategoryIcon } from '@/components/player/CategoryIcon';

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
  const [category, setCategory] = useState<string | null>(null);

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

  // Solo se muestra el filtro cuando hay más de una categoría o el menú es
  // grande: con 3 medialunas y 2 gaseosas, elegir categoría es un paso de
  // más; con una carta de 10+ platos, no filtrar es scrollear sin fin.
  const totalProducts = load.status === 'ready' ? load.productos.length : 0;
  const showCategoryFilter = grouped.length > 1 && totalProducts > 8;

  const visible = useMemo(
    () => (category ? grouped.filter(([name]) => name === category) : grouped),
    [grouped, category],
  );

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

      {showCategoryFilter && (
        <section>
          <div className="court-scroller">
            <button
              type="button"
              className={`court-chip ${category === null ? 'is-active' : ''}`}
              onClick={() => setCategory(null)}
            >
              Todo
            </button>
            {grouped.map(([name]) => (
              <button
                key={name}
                type="button"
                className={`court-chip ${category === name ? 'is-active' : ''}`}
                onClick={() => setCategory(name)}
              >
                {name}
              </button>
            ))}
          </div>
        </section>
      )}

      {visible.map(([categoryName, products]) => (
        <section className="card" key={categoryName}>
          <div className="menu-category">{categoryName}</div>
          {products.map((p) => (
            <div className="menu-item" key={p.id}>
              {p.imageUrl ? (
                <img className="menu-item-photo" src={p.imageUrl} alt="" />
              ) : (
                <CategoryIcon category={categoryName} />
              )}
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
