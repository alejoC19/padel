'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/grid';
import { useSession, useToasts } from '@/hooks';
import { Toasts } from '@/components/Toasts';

/**
 * Productos del buffet: alta, edición y baja del catálogo.
 *
 * El backend tenía el CRUD completo (`POST /pos/products`, stock por
 * compra/conteo/merma) desde antes — lo que faltaba era esta pantalla. Sin
 * ella, el dueño solo podía VENDER lo que ya estuviera cargado a mano en la
 * base: no había forma de agregar una gaseosa nueva desde la app.
 *
 * Ajustar el STOCK puntual (sumar/restar cantidad) se hace acá con el
 * mismo endpoint de conteo físico que usa el módulo de stock — cargar una
 * pantalla de "compra a proveedor" completa es un paso más that este primer
 * corte no necesita.
 */

interface Product {
  id: string; name: string; sku: string | null; barcode: string | null;
  kind: string; salePrice: number; costPrice: number; taxRate: number;
  unit: string; trackStock: boolean; stockQty: number; minStockQty: number;
  isActive: boolean; category: { id: string; name: string } | null;
}

interface Category { id: string; name: string; sortOrder: number }

export function ProductsScreen() {
  const { can } = useSession();
  const { toasts, show, dismiss } = useToasts();
  const canManage = can('product.manage');

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [formOpen, setFormOpen] = useState<'new' | Product | null>(null);
  const [stockOpen, setStockOpen] = useState<Product | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [prods, cats] = await Promise.all([api.pos.products(), api.pos.categories()]);
      setProducts(prods);
      setCategories(cats);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter((p) => {
      if (!showInactive && !p.isActive) return false;
      if (term && !p.name.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [products, search, showInactive]);

  const toggleActive = useCallback(async (p: Product) => {
    setBusyId(p.id);
    try {
      await api.pos.updateProduct(p.id, { isActive: !p.isActive });
      show(p.isActive ? 'Producto desactivado.' : 'Producto reactivado.');
      await load();
    } catch (e) {
      show(e instanceof ApiError ? e.message : 'No pudimos actualizar el producto.', 'error');
    } finally {
      setBusyId(null);
    }
  }, [load, show]);

  return (
    <div className="team-screen">
      <Toasts toasts={toasts} onDismiss={dismiss} />

      <header className="screen-head">
        <div>
          <h1 className="screen-title">Productos</h1>
          <p className="screen-sub">
            {products.filter((p) => p.isActive).length} activo
            {products.filter((p) => p.isActive).length === 1 ? '' : 's'} del buffet
          </p>
        </div>
        {canManage && (
          <div className="screen-actions">
            <button className="btn btn-primary" onClick={() => setFormOpen('new')}>
              Nuevo producto
            </button>
          </div>
        )}
      </header>

      <div className="pos-filters" style={{ marginBottom: 12 }}>
        <input
          className="input"
          placeholder="Buscar producto…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="field-block" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, margin: 0 }}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          <span className="label" style={{ margin: 0 }}>Mostrar inactivos</span>
        </label>
      </div>

      {loading ? (
        <p className="card-empty">Cargando…</p>
      ) : error ? (
        <div className="screen-empty">
          <p>No pudimos cargar los productos.</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="screen-empty">
          <p>{products.length === 0 ? 'Todavía no hay productos cargados.' : 'No hay productos que coincidan.'}</p>
        </div>
      ) : (
        <div className="panel-card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Categoría</th>
                <th className="num">Precio</th>
                <th className="num">Stock</th>
                {canManage && <th />}
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="cell-main">
                      {p.name}
                      {!p.isActive && <span className="tag-muted">inactivo</span>}
                    </div>
                  </td>
                  <td className="cell-muted">{p.category?.name ?? '—'}</td>
                  <td className="num">{formatMoney(p.salePrice)}</td>
                  <td className="num">
                    {p.trackStock ? (
                      <span className={p.stockQty <= p.minStockQty ? 'balance-owed' : ''}>
                        {p.stockQty} {p.unit}{p.stockQty === 1 ? '' : 's'}
                      </span>
                    ) : '—'}
                  </td>
                  {canManage && (
                    <td className="cell-actions">
                      {p.trackStock && (
                        <button className="btn-link" disabled={busyId === p.id} onClick={() => setStockOpen(p)}>
                          Ajustar stock
                        </button>
                      )}
                      <button className="btn-link" disabled={busyId === p.id} onClick={() => setFormOpen(p)}>
                        Editar
                      </button>
                      <button
                        className={`btn-link ${p.isActive ? 'btn-link-danger' : ''}`}
                        disabled={busyId === p.id}
                        onClick={() => void toggleActive(p)}
                      >
                        {p.isActive ? 'Desactivar' : 'Reactivar'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formOpen && (
        <ProductFormDialog
          product={formOpen === 'new' ? null : formOpen}
          categories={categories}
          onClose={() => setFormOpen(null)}
          onSaved={(msg) => { setFormOpen(null); show(msg); void load(); }}
          onError={(msg) => show(msg, 'error')}
          onCategoryCreated={(c) => setCategories((prev) => [...prev, c])}
        />
      )}

      {stockOpen && (
        <StockAdjustDialog
          product={stockOpen}
          onClose={() => setStockOpen(null)}
          onSaved={(msg) => { setStockOpen(null); show(msg); void load(); }}
          onError={(msg) => show(msg, 'error')}
        />
      )}
    </div>
  );
}

function ProductFormDialog({
  product, categories, onClose, onSaved, onError, onCategoryCreated,
}: {
  product: Product | null;
  categories: Category[];
  onClose: () => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
  onCategoryCreated: (c: Category) => void;
}) {
  const [name, setName] = useState(product?.name ?? '');
  const [salePrice, setSalePrice] = useState(String(product?.salePrice ?? ''));
  const [costPrice, setCostPrice] = useState(String(product?.costPrice ?? ''));
  const [categoryId, setCategoryId] = useState(product?.category?.id ?? '');
  const [unit, setUnit] = useState(product?.unit ?? 'unidad');
  const [trackStock, setTrackStock] = useState(product?.trackStock ?? true);
  const [initialStock, setInitialStock] = useState('');
  const [minStockQty, setMinStockQty] = useState(String(product?.minStockQty ?? 0));
  const [busy, setBusy] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [addingCategory, setAddingCategory] = useState(false);

  const createCategory = useCallback(async () => {
    if (!newCategory.trim()) return;
    setAddingCategory(true);
    try {
      const c = await api.pos.createCategory({ name: newCategory.trim() });
      onCategoryCreated(c);
      setCategoryId(c.id);
      setNewCategory('');
    } catch (e) {
      onError(e instanceof ApiError ? e.message : 'No pudimos crear la categoría.');
    } finally {
      setAddingCategory(false);
    }
  }, [newCategory, onCategoryCreated, onError]);

  const submit = useCallback(async () => {
    if (!name.trim()) {
      onError('Ponele un nombre al producto.');
      return;
    }
    const price = Number(salePrice);
    if (!salePrice || Number.isNaN(price) || price < 0) {
      onError('El precio de venta tiene que ser un número válido.');
      return;
    }
    setBusy(true);
    try {
      if (product) {
        await api.pos.updateProduct(product.id, {
          name: name.trim(),
          salePrice: price,
          costPrice: costPrice ? Number(costPrice) : 0,
          categoryId: categoryId || undefined,
          unit: unit.trim() || 'unidad',
          trackStock,
          minStockQty: Number(minStockQty) || 0,
        });
        onSaved('Producto actualizado.');
      } else {
        await api.pos.createProduct({
          name: name.trim(),
          salePrice: price,
          costPrice: costPrice ? Number(costPrice) : 0,
          categoryId: categoryId || undefined,
          unit: unit.trim() || 'unidad',
          trackStock,
          initialStock: trackStock && initialStock ? Number(initialStock) : undefined,
          minStockQty: Number(minStockQty) || 0,
        });
        onSaved('Producto creado.');
      }
    } catch (e) {
      onError(e instanceof ApiError ? e.message : 'No pudimos guardar el producto.');
    } finally {
      setBusy(false);
    }
  }, [
    product, name, salePrice, costPrice, categoryId, unit, trackStock,
    initialStock, minStockQty, onSaved, onError,
  ]);

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Producto">
        <h2 className="dialog-title">{product ? 'Editar producto' : 'Nuevo producto'}</h2>

        <label className="field-block">
          <span className="label">Nombre</span>
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <div className="field-pair">
          <label className="field-block">
            <span className="label">Precio de venta</span>
            <input
              className="input" type="number" inputMode="decimal" min={0}
              value={salePrice} onChange={(e) => setSalePrice(e.target.value)}
            />
          </label>
          <label className="field-block">
            <span className="label">Costo (opcional)</span>
            <input
              className="input" type="number" inputMode="decimal" min={0}
              value={costPrice} onChange={(e) => setCostPrice(e.target.value)}
            />
          </label>
        </div>

        <label className="field-block">
          <span className="label">Categoría</span>
          <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Sin categoría</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <div className="field-pair">
          <input
            className="input" placeholder="Nueva categoría…"
            value={newCategory} onChange={(e) => setNewCategory(e.target.value)}
          />
          <button className="btn btn-secondary" disabled={addingCategory || !newCategory.trim()}
                  onClick={() => void createCategory()}>
            {addingCategory ? 'Creando…' : 'Agregar categoría'}
          </button>
        </div>

        <label className="field-block" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={trackStock} onChange={(e) => setTrackStock(e.target.checked)} />
          <span className="label" style={{ margin: 0 }}>Controlar stock</span>
        </label>

        {trackStock && (
          <div className="field-pair">
            {!product && (
              <label className="field-block">
                <span className="label">Stock inicial</span>
                <input
                  className="input" type="number" inputMode="decimal" min={0}
                  value={initialStock} onChange={(e) => setInitialStock(e.target.value)}
                />
              </label>
            )}
            <label className="field-block">
              <span className="label">Unidad</span>
              <input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} />
            </label>
            <label className="field-block">
              <span className="label">Stock mínimo</span>
              <input
                className="input" type="number" inputMode="decimal" min={0}
                value={minStockQty} onChange={(e) => setMinStockQty(e.target.value)}
              />
            </label>
          </div>
        )}

        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Guardando…' : product ? 'Guardar' : 'Crear producto'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Ajuste por conteo físico: se carga lo CONTADO, no la diferencia — mismo criterio que el backend. */
function StockAdjustDialog({
  product, onClose, onSaved, onError,
}: {
  product: Product;
  onClose: () => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [countedQty, setCountedQty] = useState(String(product.stockQty));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async () => {
    const qty = Number(countedQty);
    if (Number.isNaN(qty) || qty < 0) {
      onError('La cantidad contada tiene que ser un número válido.');
      return;
    }
    if (!reason.trim()) {
      onError('Contá por qué ajustás el stock (ej: conteo mensual).');
      return;
    }
    setBusy(true);
    try {
      const res = await api.pos.adjustStockCount(product.id, { countedQty: qty, reason: reason.trim() });
      onSaved(
        res.difference === 0
          ? 'Stock sin cambios.'
          : `Stock ajustado: ${res.difference > 0 ? '+' : ''}${res.difference} ${product.unit}${Math.abs(res.difference) === 1 ? '' : 's'}.`,
      );
    } catch (e) {
      onError(e instanceof ApiError ? e.message : 'No pudimos ajustar el stock.');
    } finally {
      setBusy(false);
    }
  }, [countedQty, reason, product, onSaved, onError]);

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Ajustar stock">
        <h2 className="dialog-title">Ajustar stock · {product.name}</h2>
        <p className="dialog-sub">Stock actual: {product.stockQty} {product.unit}{product.stockQty === 1 ? '' : 's'}</p>

        <label className="field-block">
          <span className="label">Cantidad contada</span>
          <input
            className="input" type="number" inputMode="decimal" min={0} autoFocus
            value={countedQty} onChange={(e) => setCountedQty(e.target.value)}
          />
        </label>
        <label className="field-block">
          <span className="label">Motivo</span>
          <input
            className="input" placeholder="Conteo mensual, rotura, etc."
            value={reason} onChange={(e) => setReason(e.target.value)}
          />
        </label>

        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Guardando…' : 'Ajustar'}
          </button>
        </div>
      </div>
    </div>
  );
}
