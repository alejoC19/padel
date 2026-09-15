import { useId } from 'react';

/**
 * Marca de ClubOS: la pelota de pádel, no una letra en un cuadrado.
 *
 * El logo anterior (`.brand-mark` con una "C") es exactamente el patrón
 * "iniciales en una caja de color" que cualquier generador de logos hace
 * en dos segundos — no dice nada de qué es el producto. La pelota (con sus
 * costuras reales, no una bolita amarilla genérica) ya existía dibujada en
 * el arte de la landing (marketing/Art.tsx) pero nunca se usó fuera de ahí.
 *
 * Es un componente aparte y no reutiliza <PadelDefs> a propósito: el shell
 * de la app se monta en cada pantalla interna, y no tiene sentido cargar
 * los degradés de la raqueta/cancha (que solo usa la landing) solo para
 * mostrar una pelota de 28px en la barra de navegación.
 *
 * `useId()` para el gradiente: AppShell renderiza esta marca DOS veces (una
 * en la sidebar, otra en la topbar mobile) — ambas están siempre en el DOM
 * a la vez, una oculta por CSS según el ancho de pantalla. Con un id fijo,
 * quedan dos <radialGradient id="brand-ball"> en el documento; cuando la
 * copia visible es la SEGUNDA (la de la topbar en mobile), algunos
 * navegadores no pintan el degradé porque el primer id="brand-ball" vive
 * dentro de un subárbol con display:none — la pelota se ve sin relleno,
 * solo las costuras blancas. Un id único por instancia lo evita.
 */
export function BrandMark({ size = 28 }: { size?: number }) {
  const gradientId = `brand-ball-${useId()}`;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <radialGradient id={gradientId} cx="35%" cy="30%">
          <stop offset="0%" stopColor="#EDF56B" />
          <stop offset="55%" stopColor="#D8E63C" />
          <stop offset="100%" stopColor="#9FAD26" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="46" fill={`url(#${gradientId})`} />
      <path d="M14 22c16 14 16 42 0 56" fill="none" stroke="#fff"
            strokeWidth="5" strokeLinecap="round" opacity=".92" />
      <path d="M86 22c-16 14-16 42 0 56" fill="none" stroke="#fff"
            strokeWidth="5" strokeLinecap="round" opacity=".92" />
      <ellipse cx="34" cy="30" rx="15" ry="11" fill="#fff" opacity=".22" />
    </svg>
  );
}
