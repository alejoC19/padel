/**
 * Test de los DTOs del endpoint público de reservas.
 *
 * Hasta hace poco `PublicController.reservar` tipaba el body como un tipo TS
 * inline (`body: { courtId: string; ... }`) en vez de una clase de
 * class-validator. Un tipo TS se borra en runtime: el `ValidationPipe`
 * global (whitelist + forbidNonWhitelisted + transform) no tiene metadata
 * contra la cual validar y deja pasar cualquier cosa —un endpoint público,
 * sin login, terminaba confiando en los chequeos manuales del service como
 * única defensa. Este test prueba la clase real (`ReservarDto`), no una
 * reimplementación: si alguien le saca un decorador sin querer, esto falla.
 */
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AccessTokenDto, ReservarDto } from '../../src/public/dto/public-booking.dto';

const VALID_RESERVAR = {
  courtId: '9abd365a-ddab-4d18-982b-5fa5b2f4007f',
  startsAt: '2026-09-09T14:00:00.000Z',
  durationMinutes: 90,
  firstName: 'Ana',
  phone: '+5491122334455',
};

async function errorsFor(input: Record<string, unknown>) {
  const dto = plainToInstance(ReservarDto, input);
  return validate(dto);
}

describe('ReservarDto', () => {
  it('acepta un body válido sin errores', async () => {
    expect(await errorsFor(VALID_RESERVAR)).toHaveLength(0);
  });

  it('acepta lastName opcional', async () => {
    expect(await errorsFor({ ...VALID_RESERVAR, lastName: 'Pérez' })).toHaveLength(0);
  });

  it('rechaza courtId que no es UUID', async () => {
    const errors = await errorsFor({ ...VALID_RESERVAR, courtId: 'no-es-uuid' });
    expect(errors.some((e) => e.property === 'courtId')).toBe(true);
  });

  it('rechaza duraciones fuera de 60/90/120', async () => {
    for (const bad of [0, 15, 45, 61, 180, -90]) {
      const errors = await errorsFor({ ...VALID_RESERVAR, durationMinutes: bad });
      expect(errors.some((e) => e.property === 'durationMinutes')).toBe(true);
    }
  });

  it('rechaza startsAt que no es una fecha ISO', async () => {
    const errors = await errorsFor({ ...VALID_RESERVAR, startsAt: 'mañana a la tarde' });
    expect(errors.some((e) => e.property === 'startsAt')).toBe(true);
  });

  it('rechaza firstName vacío', async () => {
    const errors = await errorsFor({ ...VALID_RESERVAR, firstName: '' });
    expect(errors.some((e) => e.property === 'firstName')).toBe(true);
  });

  it('rechaza firstName / lastName / phone desproporcionadamente largos', async () => {
    const long = 'a'.repeat(500);
    const errorsName = await errorsFor({ ...VALID_RESERVAR, firstName: long });
    expect(errorsName.some((e) => e.property === 'firstName')).toBe(true);

    const errorsLast = await errorsFor({ ...VALID_RESERVAR, lastName: long });
    expect(errorsLast.some((e) => e.property === 'lastName')).toBe(true);

    const errorsPhone = await errorsFor({ ...VALID_RESERVAR, phone: long });
    expect(errorsPhone.some((e) => e.property === 'phone')).toBe(true);
  });

  it('rechaza teléfono demasiado corto', async () => {
    const errors = await errorsFor({ ...VALID_RESERVAR, phone: '123' });
    expect(errors.some((e) => e.property === 'phone')).toBe(true);
  });
});

describe('AccessTokenDto', () => {
  it('acepta un token no vacío', async () => {
    const dto = plainToInstance(AccessTokenDto, { accessToken: 'a'.repeat(64) });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rechaza token vacío', async () => {
    const dto = plainToInstance(AccessTokenDto, { accessToken: '' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'accessToken')).toBe(true);
  });

  it('rechaza token no-string (p. ej. un objeto inyectado en el body)', async () => {
    const dto = plainToInstance(AccessTokenDto, { accessToken: { $ne: null } });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'accessToken')).toBe(true);
  });
});
