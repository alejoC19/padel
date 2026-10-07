import { Controller, Get, Post, Body, Param, Query, Req, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { Public, SkipTenant } from '../common/decorators';
import { PublicService } from './public.service';
import { AccessTokenDto, InscribirEquipoDto, ReservarDto } from './dto/public-booking.dto';
import type { AccessTokenPayload } from '../auth/token.service';

/**
 * Endpoints PÚBLICOS para la app del jugador — la mayoría sin login (ver
 * cada método). `reservar` es la excepción: exige una cuenta de verdad
 * (ver `requireUserId`) desde que el portal dejó de aceptar invitados.
 *
 * El club se identifica por su slug en la URL:
 *   GET /public/clubs/:slug                    → datos del club
 *   GET /public/clubs/:slug/availability?date= → disponibilidad del día
 *
 * @Public: todos los métodos quedan afuera del JwtAuthGuard global (incluso
 * `reservar`, que valida el token a mano con `requireUserId` — así el 401
 * sale con el mensaje puntual de esa regla, no el genérico del guard).
 * @SkipTenant: no hay club activo en un token (lo resolvemos por slug
 * adentro). Throttle: son endpoints abiertos, los limitamos para evitar
 * abuso.
 */
@Controller('public/clubs')
@Public()
@SkipTenant()
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class PublicController {
  constructor(
    private readonly svc: PublicService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Decodifica el Bearer de una cuenta logueada (/jugador/cuenta), si vino
   * y es válido. Sigue siendo la pieza de `reservar()` (abajo), que YA NO
   * acepta invitados — sin token, con uno vencido, o con cualquier otra
   * cosa rota en el header, esto devuelve `null` y es `requireUserId`
   * quien decide qué hacer con eso.
   */
  private async optionalUserId(req: Request): Promise<string | null> {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(
        header.slice(7),
        { secret: process.env.JWT_ACCESS_SECRET },
      );
      return payload.sub;
    } catch {
      return null;
    }
  }

  /**
   * Como `optionalUserId`, pero exige que haya resultado — para `reservar`,
   * que no es público "de verdad" (necesita cuenta) aunque el controller
   * entero esté marcado `@Public()` (eso solo saca a TODOS sus métodos del
   * JwtAuthGuard global; acá se vuelve a pedir el token a mano para dar un
   * 401 con mensaje propio en vez de caer en guest).
   */
  private async requireUserId(req: Request): Promise<string> {
    const userId = await this.optionalUserId(req);
    if (!userId) {
      throw new UnauthorizedException('Necesitás iniciar sesión para reservar.');
    }
    return userId;
  }

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
   * Reserva de un jugador logueado. Hasta que el portal exigió cuenta,
   * esto aceptaba invitado (`optionalUserId`) — ahora es `requireUserId`:
   * sin cuenta válida, 401. Límite más estricto que las lecturas: crear
   * reservas es una acción, no una consulta.
   */
  @Post(':slug/reservar')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async reservar(
    @Param('slug') slug: string,
    @Body() body: ReservarDto,
    @Req() req: Request,
  ) {
    const userId = await this.requireUserId(req);
    return this.svc.reservar(slug, body, userId);
  }

  /**
   * Reservas por teléfono — de antes de que el portal exigiera cuenta
   * para reservar; queda para encontrar reservas viejas de esa época.
   * Consulta de bajo valor a propósito: el teléfono no es secreto, así que
   * esto NO devuelve precio ni el accessToken — solo confirma qué
   * reservó, para encontrar el comprobante.
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
    @Body() body: AccessTokenDto,
  ) {
    return this.svc.checkout(slug, id, body.accessToken);
  }

  /** Cancelar una reserva del jugador (requiere el accessToken de la reserva). */
  @Post(':slug/reservas/:id/cancelar')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  cancelar(
    @Param('slug') slug: string,
    @Param('id') id: string,
    @Body() body: AccessTokenDto,
  ) {
    return this.svc.cancelar(slug, id, body.accessToken);
  }

  /** Menú del buffet: solo ver nombre, precio y categoría. */
  @Get(':slug/productos')
  menu(@Param('slug') slug: string) {
    return this.svc.menu(slug);
  }

  /** Torneos con inscripción abierta o próximos a jugarse. */
  @Get(':slug/torneos')
  tournaments(@Param('slug') slug: string) {
    return this.svc.tournaments(slug);
  }

  /** Detalle de un torneo (equipos ya anotados). */
  @Get(':slug/torneos/:id')
  tournamentDetail(@Param('slug') slug: string, @Param('id') id: string) {
    return this.svc.tournamentDetail(slug, id);
  }

  /** Inscribe un equipo (invitado, sin login). Devuelve el accessToken del equipo. */
  @Post(':slug/torneos/:id/inscribir')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  inscribirEquipo(
    @Param('slug') slug: string,
    @Param('id') id: string,
    @Body() body: InscribirEquipoDto,
  ) {
    return this.svc.inscribirEquipo(slug, id, body);
  }

  /** Comprobante de la inscripción de un equipo (requiere su accessToken). */
  @Get(':slug/equipos/:teamId')
  equipoDetalle(
    @Param('slug') slug: string,
    @Param('teamId') teamId: string,
    @Query('token') token: string,
  ) {
    return this.svc.equipoDetalle(slug, teamId, token);
  }

  /** Checkout online (Mercado Pago) de la inscripción de un equipo. */
  @Post(':slug/equipos/:teamId/checkout')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  checkoutInscripcion(
    @Param('slug') slug: string,
    @Param('teamId') teamId: string,
    @Body() body: AccessTokenDto,
  ) {
    return this.svc.checkoutInscripcion(slug, teamId, body.accessToken);
  }
}
