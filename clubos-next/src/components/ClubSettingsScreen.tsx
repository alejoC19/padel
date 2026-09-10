'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useToasts } from '@/hooks';
import { Toasts } from '@/components/Toasts';

/**
 * Datos del club: nombre y logo.
 *
 * Hasta esta pantalla, el nombre y el logo solo se podían cargar en el
 * onboarding — corregir un error de tipeo o poner el logo después
 * requería tocar la base a mano. El logo, además, es lo que usa la PWA
 * instalable de cada club (ver manifest.webmanifest) como ícono al
 * "Agregar a inicio" — antes de esto todos los clubes compartían el
 * ícono genérico de ClubOS.
 */
export function ClubSettingsScreen() {
  const { toasts, show, dismiss } = useToasts();

  const [name, setName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const club = await api.clubs.me();
      setName(club.name);
      setLogoUrl(club.logoUrl ?? '');
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async () => {
    if (!name.trim()) {
      show('Ponele un nombre al club.', 'error');
      return;
    }
    setSaving(true);
    try {
      await api.clubs.update({ name: name.trim(), logoUrl: logoUrl.trim() });
      show('Guardado. El ícono de instalación puede tardar en actualizarse en dispositivos que ya la tengan instalada.');
    } catch (e) {
      show(e instanceof ApiError ? e.message : 'No pudimos guardar los cambios.', 'error');
    } finally {
      setSaving(false);
    }
  }, [name, logoUrl, show]);

  if (loading) return <p className="card-empty">Cargando…</p>;
  if (error) {
    return (
      <div className="screen-empty">
        <p>No pudimos cargar los datos del club.</p>
      </div>
    );
  }

  return (
    <div className="team-screen">
      <Toasts toasts={toasts} onDismiss={dismiss} />

      <header className="screen-head">
        <div>
          <h1 className="screen-title">Ajustes del club</h1>
          <p className="screen-sub">Nombre y logo — se usan en la carta pública y al instalar la app.</p>
        </div>
      </header>

      <div className="panel-card" style={{ maxWidth: 480 }}>
        <label className="field-block">
          <span className="label">Nombre del club</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <label className="field-block">
          <span className="label">URL del logo</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {logoUrl && (
              <img
                src={logoUrl} alt=""
                style={{ width: 56, height: 56, borderRadius: 12, objectFit: 'cover', flexShrink: 0 }}
                onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }}
                onLoad={(e) => { (e.target as HTMLImageElement).style.visibility = 'visible'; }}
              />
            )}
            <input
              className="input" placeholder="https://…" style={{ flex: 1 }}
              value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)}
            />
          </div>
          <span className="field-hint">
            Pegá el link de una foto ya subida (Google Fotos, Imgur, etc.). Se ve mejor si es cuadrada.
          </span>
        </label>

        <button className="btn btn-primary" disabled={saving} onClick={() => void save()}>
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </div>
  );
}
