'use client';

import { useEffect, useState } from 'react';
import { applyTheme, getActiveTheme, type Theme } from '@/lib/theme';

/**
 * Botón de modo claro/oscuro. Un solo componente para las 3 superficies
 * (panel de staff, portal del jugador, landing) — cada una lo monta con su
 * propia clase para posicionarlo, el comportamiento es siempre el mismo.
 */
export function ThemeToggle({ className = '' }: { className?: string }) {
  // Arranca en 'dark' para que el markup del server coincida con el primer
  // paint (el script inline de <head> ya puede haber puesto 'light' en el
  // <html>, pero este estado de React recién lo sabe después de montar).
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => { setTheme(getActiveTheme()); }, []);

  function toggle() {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    applyTheme(next);
    setTheme(next);
  }

  return (
    <button
      type="button"
      className={`theme-toggle-btn ${className}`.trim()}
      onClick={toggle}
      aria-label={theme === 'light' ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'}
      title={theme === 'light' ? 'Modo oscuro' : 'Modo claro'}
    >
      {theme === 'light' ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
    </svg>
  );
}
