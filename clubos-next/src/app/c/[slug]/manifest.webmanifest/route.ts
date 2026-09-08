import { NextResponse } from 'next/server';

/**
 * Manifest de la PWA del jugador — UNO POR CLUB.
 *
 * Cada club público (`/c/[slug]`) es, para "instalar app", una PWA
 * independiente: `start_url`/`scope` apuntan a ESE club, así que cuando el
 * jugador toca "Agregar a inicio" en /c/mi-club, el ícono que le queda en
 * el teléfono abre directo la agenda de mi-club.
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

  return NextResponse.json(
    {
      name: 'ClubOS',
      short_name: 'ClubOS',
      description: 'Reservá tu cancha, anotate a torneos y mirá el buffet.',
      start_url: scope,
      scope,
      display: 'standalone',
      background_color: '#f4f6f8',
      theme_color: '#c8443e',
      orientation: 'portrait',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      ],
    },
    { headers: { 'Content-Type': 'application/manifest+json' } },
  );
}
