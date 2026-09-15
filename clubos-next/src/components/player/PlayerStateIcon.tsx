/**
 * Ícono para las pantallas de estado del portal (error, no encontrado, sin
 * acceso, vacío) — mismo lenguaje de línea que el resto de la app (ver
 * Toasts.tsx, CategoryIcon.tsx). Antes estas pantallas usaban emoji
 * (🎾/⚠️/🔒/🔎/🏟️), la única parte del portal que no seguía ese lenguaje.
 */
type Kind = 'warning' | 'locked' | 'search' | 'court' | 'drink' | 'trophy';

const PATHS: Record<Kind, React.ReactNode> = {
  warning: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16h.01" />
    </>
  ),
  locked: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </>
  ),
  court: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M12 4v16M3 12h18" />
    </>
  ),
  drink: (
    <>
      <path d="m6 8 1.5 12h9L18 8" />
      <path d="M5 8h14l-1-4H6L5 8Z" />
      <path d="M12 4V2" />
    </>
  ),
  trophy: (
    <>
      <path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4Z" />
      <path d="M17 5h2a2 2 0 0 1 0 4h-2M7 5H5a2 2 0 0 0 0 4h2" />
    </>
  ),
};

const TONE: Partial<Record<Kind, 'danger'>> = {
  warning: 'danger',
  locked: 'danger',
};

export function PlayerStateIcon({ kind }: { kind: Kind }) {
  const tone = TONE[kind];
  return (
    <div className={`state-icon${tone ? ` is-${tone}` : ''}`}>
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {PATHS[kind]}
      </svg>
    </div>
  );
}
