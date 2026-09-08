/**
 * Ícono + color por categoría de producto, para el buffet del jugador.
 *
 * No hay fotos reales de producto en la mayoría de los clubes (nadie cargó
 * imágenes en el POS), así que en vez de arriesgar un ícono/foto genérica
 * fea ("una botella de agua rara"), cada categoría tiene su propio ícono
 * de línea + color de marca — se ve intencional y prolijo en cualquier
 * catálogo, sin depender de que el club suba fotos. Si el producto SÍ tiene
 * `imageUrl` (cargada por el club), esa gana — ver PlayerBuffetScreen.
 */

interface IconDef {
  bg: string;
  fg: string;
  icon: React.ReactNode;
}

const DEFS = {
  bebidas: {
    bg: 'rgba(43, 143, 196, 0.18)',
    fg: '#5da8e8',
    icon: (
      <>
        <path d="M6 3h9l-.9 12.5a2 2 0 0 1-2 1.5H8.9a2 2 0 0 1-2-1.5L6 3Z" />
        <path d="M4.5 3h12" />
        <path d="M9 8h3" />
      </>
    ),
  },
  snacks: {
    bg: 'rgba(199, 125, 32, 0.2)',
    fg: '#e3ab52',
    icon: (
      <>
        <circle cx="12" cy="12" r="8" />
        <circle cx="9" cy="10" r="1" fill="currentColor" stroke="none" />
        <circle cx="14" cy="9" r="1" fill="currentColor" stroke="none" />
        <circle cx="15" cy="14" r="1" fill="currentColor" stroke="none" />
        <circle cx="10" cy="15" r="1" fill="currentColor" stroke="none" />
      </>
    ),
  },
  paletas: {
    bg: 'rgba(139, 92, 246, 0.2)',
    fg: '#b19af7',
    icon: (
      <>
        <rect x="6" y="3" width="12" height="14" rx="6" />
        <line x1="12" y1="17" x2="12" y2="21" />
        <line x1="9" y1="21" x2="15" y2="21" />
      </>
    ),
  },
  pelotas: {
    bg: 'rgba(139, 168, 24, 0.22)',
    fg: '#d4e457',
    icon: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 4a8 8 0 0 0 0 16" />
        <path d="M12 4a8 8 0 0 1 0 16" />
      </>
    ),
  },
  accesorios: {
    bg: 'rgba(219, 86, 150, 0.2)',
    fg: '#ef7bb0',
    icon: (
      <>
        <path d="M9 8V6a3 3 0 0 1 6 0v2" />
        <rect x="5" y="8" width="14" height="12" rx="2.5" />
      </>
    ),
  },
  alquiler: {
    bg: 'rgba(46, 157, 110, 0.2)',
    fg: '#4ecb92',
    icon: (
      <>
        <circle cx="8" cy="15" r="3.5" />
        <path d="M10.5 12.5 19 4" />
        <path d="M16 7l2.5 2.5" />
        <path d="M13.3 9.7 15.5 12" />
      </>
    ),
  },
  otros: {
    bg: 'rgba(255, 255, 255, 0.08)',
    fg: '#98a2b3',
    icon: (
      <>
        <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
        <circle cx="12" cy="12" r="4" />
      </>
    ),
  },
} satisfies Record<string, IconDef>;

function matchCategory(category: string): IconDef {
  const c = category.toLowerCase();
  if (c.includes('bebida') || c.includes('agua') || c.includes('gaseosa')) return DEFS.bebidas;
  if (c.includes('snack') || c.includes('golosina') || c.includes('comida')) return DEFS.snacks;
  if (c.includes('paleta') || c.includes('raqueta')) return DEFS.paletas;
  if (c.includes('pelota')) return DEFS.pelotas;
  if (c.includes('accesorio') || c.includes('indument') || c.includes('ropa')) return DEFS.accesorios;
  if (c.includes('alquiler') || c.includes('renta')) return DEFS.alquiler;
  return DEFS.otros;
}

export function CategoryIcon({ category }: { category: string }) {
  const def = matchCategory(category);
  return (
    <span className="category-icon" style={{ background: def.bg, color: def.fg }}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {def.icon}
      </svg>
    </span>
  );
}
