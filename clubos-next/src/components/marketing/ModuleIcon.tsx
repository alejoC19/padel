/**
 * Íconos de módulo para la landing pública — mismo trazo (paths de
 * AppShell.tsx) que ve el dueño del club en la sidebar apenas entra. Antes
 * la landing usaba emoji (📅💵👥🥤🏆📊🏦): quedaba como una plantilla
 * genérica y era la única parte del producto con otro lenguaje de ícono.
 */
const PATHS: Record<string, React.ReactNode> = {
  agenda: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18M8 2v4M16 2v4" />
    </>
  ),
  caja: (
    <>
      <rect x="2" y="6" width="20" height="13" rx="2" />
      <path d="M2 11h20M6 15h4" />
    </>
  ),
  clientes: (
    <>
      <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 00-3-3.87" />
    </>
  ),
  buffet: (
    <>
      <path d="M6 2h12l-1 8H7L6 2z" />
      <path d="M7 10v11a1 1 0 001 1h8a1 1 0 001-1V10" />
    </>
  ),
  torneos: (
    <>
      <path d="M6 9H4.5a2.5 2.5 0 010-5H6M18 9h1.5a2.5 2.5 0 000-5H18" />
      <path d="M6 4h12v5a6 6 0 01-12 0V4zM12 15v4M8 22h8" />
    </>
  ),
  reportes: (
    <>
      <path d="M3 3v18h18" />
      <path d="M7 15l4-5 4 3 5-7" />
    </>
  ),
  tesoreria: (
    <>
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2M12 12v4M10 14h4" />
    </>
  ),
};

export type ModuleIconName = keyof typeof PATHS;

export function ModuleIcon({ name }: { name: ModuleIconName }) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
