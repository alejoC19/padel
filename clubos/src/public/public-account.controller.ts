import { Controller, Get } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SkipTenant, UserId } from '../common/decorators';
import { PublicService } from './public.service';

/**
 * Endpoints de la cuenta logueada del jugador (/jugador/cuenta).
 *
 * A diferencia de `PublicController`/`PublicPlayerController` (`@Public()`
 * a nivel de clase, sin excepción), ACÁ sí hace falta un access token real:
 * no se decora `@Public()`, así que `JwtAuthGuard` exige Bearer válido y
 * `TenantGuard` monta el contexto (gracias a `@SkipTenant()`, sin exigir
 * club activo — esta cuenta es de plataforma, no de un club puntual).
 */
@Controller('public/jugador/cuenta')
@SkipTenant()
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class PublicAccountController {
  constructor(private readonly svc: PublicService) {}

  /** Reservas futuras de la cuenta logueada, en todos los clubes de la plataforma. */
  @Get('reservas')
  misReservas(@UserId() userId: string) {
    return this.svc.misReservasDeCuenta(userId);
  }
}
