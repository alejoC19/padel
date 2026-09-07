/**
 * Tests del formateo de fecha/hora/plata de los mensajes.
 *
 * Importa las funciones reales de format.util. Verifican que la salida esté en
 * español, en la zona horaria correcta (clave: una reserva a las 19:00 en
 * Buenos Aires no debe mostrarse en UTC), y con el formato de plata argentino.
 */
import {
  formatBookingDate,
  formatBookingTime,
  formatMoney,
} from '../../src/notifications/services/format.util';

const TZ = 'America/Argentina/Buenos_Aires';

describe('formatBookingTime', () => {
  it('muestra la hora en la zona del club, no en UTC', () => {
    // 22:00 UTC = 19:00 en Buenos Aires (UTC-3).
    const utc = new Date('2026-08-02T22:00:00Z');
    expect(formatBookingTime(utc, TZ)).toBe('19:00');
  });

  it('usa formato 24h', () => {
    const utc = new Date('2026-08-02T01:30:00Z'); // 22:30 del día anterior en BA
    expect(formatBookingTime(utc, TZ)).toBe('22:30');
  });
});

describe('formatBookingDate', () => {
  it('devuelve la fecha en español', () => {
    const utc = new Date('2026-08-02T15:00:00Z'); // 12:00 en BA, domingo 2 ago
    const s = formatBookingDate(utc, TZ);
    expect(s).toMatch(/agosto/);
    expect(s).toMatch(/2/);
  });

  it('respeta la zona horaria al cruzar medianoche', () => {
    // 01:00 UTC del 3 = 22:00 del 2 en BA. La fecha local es el 2, no el 3.
    const utc = new Date('2026-08-03T01:00:00Z');
    const s = formatBookingDate(utc, TZ);
    expect(s).toMatch(/2/);
  });
});

describe('formatMoney', () => {
  it('formatea pesos argentinos', () => {
    const s = formatMoney(12500);
    // Formato es-AR: separador de miles con punto, símbolo $.
    expect(s).toMatch(/\$/);
    expect(s).toMatch(/12\.500/);
  });

  it('incluye centavos', () => {
    const s = formatMoney(1234.5);
    expect(s).toMatch(/1\.234,50/);
  });
});
