'use client';

/**
 * Modo claro/oscuro de toda la app (staff + jugador + landing).
 *
 * Un solo `data-theme` en <html>, compartido por TODAS las hojas de estilo
 * (cada una define sus propios `--ds-*`/`--app-*`/`--auth-*`/`--lp-*` bajo
 * `:root[data-theme="light"]`) — tocar este archivo no toca ningún color,
 * solo el mecanismo que decide y persiste cuál mostrar.
 */

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'padelapp2.theme';

export function getStoredTheme(): Theme | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === 'light' || raw === 'dark' ? raw : null;
  } catch {
    return null;
  }
}

/** Lee el tema ya aplicado por el script inline de <head> (ver layout.tsx). */
export function getActiveTheme(): Theme {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage no disponible (Safari privado, cuota llena) — el toggle sigue
    // funcionando para esta sesión, solo no persiste entre visitas.
  }
}

/**
 * Script inyectado inline en <head>, antes de cualquier pintado — decide el
 * tema sin esperar a que React hidrate, para no mostrar un flash del tema
 * equivocado. Mismo criterio que localStorage + prefers-color-scheme de
 * cualquier sitio con toggle manual: preferencia guardada > del sistema.
 */
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('${STORAGE_KEY}');
    var theme = stored === 'light' || stored === 'dark'
      ? stored
      : (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
`;
