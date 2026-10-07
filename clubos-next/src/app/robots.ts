import type { MetadataRoute } from 'next';

const SITE_URL = 'https://padelapp2.com';

/**
 * Espeja las decisiones de `robots` que ya tiene cada layout (ver
 * `metadata.robots` en agenda/caja/clientes/etc. vs. page.tsx/jugador/c/[slug]):
 * esto NO introduce política nueva, solo la hace visible para los
 * buscadores — sin este archivo no hay /robots.txt en absoluto y Google no
 * tiene de dónde sacar el sitemap.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/agenda', '/caja', '/canchas', '/clientes', '/buffet', '/productos',
        '/torneos', '/tesoreria', '/reportes', '/equipo', '/club',
        '/entrar', '/olvide-password', '/restablecer-contrasena', '/aceptar-invitacion',
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
