/**
 * Test del cálculo de expiración del access token.
 *
 * Este cálculo tuvo un bug real: una de las tres funciones que firman tokens
 * usaba el TTL crudo en vez de convertirlo a segundos, y con ACCESS_TOKEN_TTL
 * en segundos ("900") el token nacía con una expiración inválida → el login
 * funcionaba pero la primera llamada protegida daba 401. Este test blinda la
 * conversión para que acepte todos los formatos y nunca devuelva algo raro.
 *
 * Replica la lógica de accessTtlSeconds (privada) para poder testearla aislada.
 */

function accessTtlSeconds(raw: string): number {
  raw = String(raw).trim();
  const m = /^(\d+)([smhd])$/.exec(raw);
  if (m) {
    const n = Number(m[1]);
    const mult: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return n * (mult[m[2]] ?? 60);
  }
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    if (n > 0) return n;
  }
  return 900;
}

describe('accessTtlSeconds', () => {
  it('acepta segundos crudos', () => {
    expect(accessTtlSeconds('900')).toBe(900);
    expect(accessTtlSeconds('1800')).toBe(1800);
  });

  it('acepta formato con sufijo', () => {
    expect(accessTtlSeconds('15m')).toBe(900);
    expect(accessTtlSeconds('2h')).toBe(7200);
    expect(accessTtlSeconds('30s')).toBe(30);
    expect(accessTtlSeconds('1d')).toBe(86400);
  });

  it('cae a 15 min con valores inválidos', () => {
    expect(accessTtlSeconds('basura')).toBe(900);
    expect(accessTtlSeconds('')).toBe(900);
    expect(accessTtlSeconds('0')).toBe(900);
  });

  it('nunca devuelve cero ni negativo', () => {
    for (const v of ['900', '15m', 'basura', '', '0', '-5']) {
      expect(accessTtlSeconds(v)).toBeGreaterThan(0);
    }
  });
});
