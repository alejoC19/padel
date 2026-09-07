/**
 * Tests del cifrado de secretos de terceros (tokens de Mercado Pago).
 *
 * Es código de seguridad: un bug acá significa tokens ilegibles (los clubes
 * pierden su conexión de cobro) o, peor, secretos expuestos. Se prueba el
 * round-trip, la unicidad del ciphertext y la detección de manipulación.
 */
import { CryptoService } from '../../src/payments-gateway/services/crypto.service';
import type { ConfigService } from '@nestjs/config';

function makeService(key = 'una-clave-de-al-menos-treinta-y-dos-caracteres') {
  const config = { get: (k: string) => (k === 'PAYMENTS_ENC_KEY' ? key : undefined) };
  return new CryptoService(config as unknown as ConfigService);
}

describe('CryptoService', () => {
  it('descifra lo que cifró (round-trip)', () => {
    const svc = makeService();
    const secret = 'APP_USR-1234567890-mercadopago-token';
    expect(svc.decrypt(svc.encrypt(secret))).toBe(secret);
  });

  it('produce ciphertext distinto para el mismo texto (salt/iv aleatorios)', () => {
    const svc = makeService();
    const a = svc.encrypt('mismo-token');
    const b = svc.encrypt('mismo-token');
    expect(a).not.toBe(b);
    // Pero ambos descifran a lo mismo.
    expect(svc.decrypt(a)).toBe(svc.decrypt(b));
  });

  it('detecta manipulación del ciphertext (GCM auth)', () => {
    const svc = makeService();
    const enc = svc.encrypt('token-sensible');
    const parts = enc.split(':');
    // Corromper el último bloque (los datos).
    const tampered = [parts[0], parts[1], parts[2], 'AAAA' + parts[3].slice(4)].join(':');
    expect(() => svc.decrypt(tampered)).toThrow();
  });

  it('falla al descifrar con otra clave', () => {
    const a = makeService('clave-A-de-treinta-y-dos-caracteres-minimo');
    const b = makeService('clave-B-distinta-de-treinta-y-dos-caract');
    const enc = a.encrypt('secreto');
    expect(() => b.decrypt(enc)).toThrow();
  });

  it('rechaza formato inválido', () => {
    const svc = makeService();
    expect(() => svc.decrypt('no-tiene-formato')).toThrow();
    expect(() => svc.decrypt('solo:dos')).toThrow();
  });

  it('exige una clave de longitud mínima', () => {
    expect(() => makeService('corta')).toThrow();
  });

  it('maneja unicode y strings largos', () => {
    const svc = makeService();
    const secret = '🎾 token con acentos áéí y emojis 🔐 '.repeat(50);
    expect(svc.decrypt(svc.encrypt(secret))).toBe(secret);
  });
});
