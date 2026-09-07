/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /**
   * Proxy al backend en desarrollo.
   *
   * Evita configurar CORS y, más importante, hace que la cookie httpOnly del
   * refresh token viaje sin dominios cruzados — que es donde suele romperse
   * la sesión al pasar de desarrollo a producción.
   */
  async rewrites() {
    const target = process.env.API_URL ?? 'http://localhost:3000';
    return [{ source: '/api/:path*', destination: `${target}/api/:path*` }];
  },

  /**
   * Cabeceras de seguridad.
   *
   * La CSP permite 'unsafe-inline' en estilos porque los componentes usan
   * `style` para posicionar los bloques de la agenda: la posición depende
   * del horario, no se puede resolver con clases estáticas.
   */
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      ],
    }];
  },
};

export default nextConfig;
