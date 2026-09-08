import { NextResponse } from 'next/server';

/**
 * Manifest de la app UNIFICADA del jugador.
 *
 * Route Handler, no el archivo especial `manifest.ts` de Next: en este
 * proyecto ese archivo especial solo generó ruta en la raíz de `src/app`
 * (probado con `/c/[slug]/manifest.ts`, que tampoco generó nada estando
 * anidado) — un Route Handler explícito es la vía que sí funciona en
 * cualquier profundidad. `JugadorLayout` linkea esto a mano.
 */
export async function GET() {
  return NextResponse.json(
    {
      name: 'ClubOS',
      short_name: 'ClubOS',
      description: 'Encontrá cualquier club de pádel de ClubOS y mirá tus reservas, todo en una sola app.',
      start_url: '/jugador',
      scope: '/jugador',
      display: 'standalone',
      background_color: '#12151d',
      theme_color: '#0ea5a0',
      orientation: 'portrait',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      ],
    },
    { headers: { 'Content-Type': 'application/manifest+json' } },
  );
}
