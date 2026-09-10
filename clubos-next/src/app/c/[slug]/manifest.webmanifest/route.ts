import { NextResponse } from 'next/server';
import { publicApi } from '@/lib/publicApi';

/**
 * Manifest de la PWA del jugador — UNO POR CLUB.
 *
 * Cada club público (`/c/[slug]`) es, para "instalar app", una PWA
 * independiente: `start_url`/`scope` apuntan a ESE club, así que cuando el
 * jugador toca "Agregar a inicio" en /c/mi-club, el ícono que le queda en
 * el teléfono abre directo la agenda de mi-club.
 *
 * El nombre y el ícono salen del logo que el club cargó en Ajustes → Club
 * (`api.clubs.update`). Sin logo cargado, se usa el genérico de ClubOS —
 * mismo criterio que el resto de la app: un campo vacío no rompe nada,
 * solo se ve menos personalizado.
 *
 * Se implementa como Route Handler (no como el archivo especial
 * `manifest.ts` de Next) porque ese archivo especial no soporta quedar
 * anidado dentro de un segmento dinámico (`[slug]`) — no genera la ruta.
 * `PlayerLayout` linkea esto a mano vía `generateMetadata`.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const scope = `/c/${slug}`;

  const club = await publicApi.getClub(slug).catch(() => null);
  const name = club?.name ?? 'ClubOS';

  // El logo es una URL cualquiera (no un asset pre-recortado a 192/512):
  // se declara en los dos tamaños igual, el navegador la escala. Es la
  // misma limitación ya aceptada para las fotos de producto del buffet.
  const icons = club?.logoUrl
    ? [
        { src: club.logoUrl, sizes: '192x192', type: 'image/png', purpose: 'any' as const },
        { src: club.logoUrl, sizes: '512x512', type: 'image/png', purpose: 'any' as const },
      ]
    : [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' as const },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' as const },
      ];

  return NextResponse.json(
    {
      name,
      short_name: name,
      description: 'Reservá tu cancha, anotate a torneos y mirá el buffet.',
      start_url: scope,
      scope,
      display: 'standalone',
      background_color: '#12151d',
      theme_color: '#0ea5a0',
      orientation: 'portrait',
      icons,
    },
    { headers: { 'Content-Type': 'application/manifest+json' } },
  );
}
