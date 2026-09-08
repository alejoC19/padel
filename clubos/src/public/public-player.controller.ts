import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public, SkipTenant } from '../common/decorators';
import { PublicService } from './public.service';

/**
 * Endpoints de la app UNIFICADA del jugador (`/jugador`), a diferencia de
 * `PublicController` (`/public/clubs/:slug`) que es por club. Estos NO
 * llevan slug: recorren todos los clubes de la plataforma — ver el
 * comentario en `public.service.ts` sobre por qué esto es orquestación y
 * no un modelo de "Jugador" nuevo.
 */
@Controller('public/jugador')
@Public()
@SkipTenant()
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class PublicPlayerController {
  constructor(private readonly svc: PublicService) {}

  @Get('clubes')
  directorio(@Query('q') q?: string) {
    return this.svc.directorio(q);
  }

  @Get('mis-reservas')
  misReservas(@Query('phone') phone: string) {
    return this.svc.misReservasJugador(phone);
  }
}
