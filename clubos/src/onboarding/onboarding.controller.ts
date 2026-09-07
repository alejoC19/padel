import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public, SkipTenant } from '../common/decorators';
import { OnboardingService } from './services/onboarding.service';
import { CheckSlugDto, CreateClubDto } from './dto/onboarding.dto';

/**
 * Alta de clubes nuevos. Público: quien lo usa todavía no tiene cuenta.
 *
 * @SkipTenant porque no hay club activo (lo estamos creando), y @Public
 * porque no hay sesión. La creación es transaccional en el servicio.
 */
@Controller('onboarding')
@Public()
@SkipTenant()
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  /** ¿Está libre este slug? Para validar en vivo en el wizard. */
  @Get('slug-available')
  checkSlug(@Query() dto: CheckSlugDto) {
    return this.onboarding.checkSlug(dto.slug);
  }

  /**
   * Crea el club + dueño + configuración por defecto y devuelve una sesión
   * iniciada (el dueño queda logueado).
   *
   * Límite estricto: crear clubes es caro (transacción grande) y no debería
   * pasar seguido desde una misma IP. Frena spam de altas.
   */
  @Throttle({ default: { limit: 3, ttl: 600_000 } })
  @Post('club')
  createClub(@Body() dto: CreateClubDto, @Req() req: Request) {
    return this.onboarding.createClub(dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
