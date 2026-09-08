import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

/**
 * Generación/verificación de tokens de un solo uso enviados por email
 * (reset de contraseña, invitación de staff, comprobante de reserva
 * pública). Mismo patrón en los tres casos: 256 bits aleatorios, se
 * persiste el hash SHA-256 y el crudo viaja una única vez fuera del
 * sistema — así una fuga de la base no expone tokens utilizables.
 */
export function generateSecureToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('hex');
  return { raw, hash: hashToken(raw) };
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Comparación en tiempo constante: evita timing attacks de fuerza bruta. */
export function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
