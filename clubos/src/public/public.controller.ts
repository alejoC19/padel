import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public, SkipTenant } from '../common/decorators';
import { PublicService } from './public.service';

/**
 * Endpoints PÚBLICOS para la app del jugador. Sin login.
 *
 * El club se identifica por su slug en la URL:
 *   GET /public/clubs/:slug                    → datos del club
 *   GET /public/clubs/:slug/availability?date= → disponibilidad del día
 *
 * @Public: no exige token. @SkipTenant: no hay club activo en un token (lo
 * resolvemos por slug adentro). Throttle: son endpoints abiertos, los limitamos
 * para evitar abuso.
 */
@Controller('public/clubs')
@Public()
@SkipTenant()
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class PublicController {
  constructor(private readonly svc: PublicService) {}

  @Get(':slug')
  getClub(@Param('slug') slug: string) {
    return this.svc.getClub(slug);
  }

  @Get(':slug/availability')
  availability(
    @Param('slug') slug: string,
    @Query('date') date: string,
  ) {
    return this.svc.availability(slug, date);
  }

  /**
   * Reserva de invitado (sin login). Límite más estricto que las lecturas:
   * crear reservas es una acción, no una consulta.
   */
  @Post(':slug/reservar')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  reservar(
    @Param('slug') slug: string,
    @Body()
    body: {
      courtId: string;
      startsAt: string;
      durationMinutes: number;
      firstName: string;
      lastName?: string;
      phone: string;
    },
  ) {
    return this.svc.reservar(slug, body);
  }

  /**
   * Reservas del jugador, por teléfono. Consulta de bajo valor a propósito:
   * el teléfono no es secreto, así que esto NO devuelve precio ni el
   * accessToken — solo confirma qué reservó, para encontrar el comprobante.
   */
  @Get(':slug/mis-reservas')
  misReservas(
    @Param('slug') slug: string,
    @Query('phone') phone: string,
  ) {
    return this.svc.misReservas(slug, phone);
  }

  /**
   * Detalle completo / comprobante de una reserva. Requiere el accessToken
   * que se entregó al crear la reserva (no el teléfono).
   */
  @Get(':slug/reservas/:id')
  consultar(
    @Param('slug') slug: string,
    @Param('id') id: string,
    @Query('token') token: string,
  ) {
    return this.svc.consultar(slug, id, token);
  }

  /**
   * Checkout online (Mercado Pago) de una reserva pública. Requiere el
   * accessToken de la reserva. Devuelve el link de Checkout Pro.
   */
  @Post(':slug/reservas/:id/checkout')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  checkout(
    @Param('slug') slug: string,
    @Param('id') id: string,
    @Body() body: { accessToken: string },
  ) {
    return this.svc.checkout(slug, id, body.accessToken);
  }

  /** Cancelar una reserva del jugador (requiere el accessToken de la reserva). */
  @Post(':slug/reservas/:id/cancelar')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  cancelar(
    @Param('slug') slug: string,
    @Param('id') id: string,
    @Body() body: { accessToken: string },
  ) {
    return this.svc.cancelar(slug, id, body.accessToken);
  }
}
