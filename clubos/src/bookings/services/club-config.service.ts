import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

interface CachedClub {
  timezone: string;
  currency: string;
  locale: string;
  settings: Record<string, unknown>;
  cachedAt: number;
}

/**
 * Acceso cacheado a la configuración del club.
 *
 * La zona horaria se necesita en casi toda operación de agenda. Consultarla
 * en cada request suma una query innecesaria a un dato que cambia una vez
 * al año.
 *
 * Cache en memoria del proceso, TTL 5 minutos. Con varias instancias cada
 * una tiene la suya, lo que significa hasta 5 minutos de inconsistencia
 * tras un cambio de configuración — aceptable para estos campos. Si más
 * adelante se cachean datos sensibles al cambio inmediato, mover a Redis
 * con invalidación por evento.
 */
@Injectable()
export class ClubConfigService {
  private readonly cache = new Map<string, CachedClub>();
  private readonly ttlMs = 5 * 60_000;

  constructor(private readonly prisma: PrismaService) {}

  async get(clubId: string): Promise<CachedClub> {
    const hit = this.cache.get(clubId);
    if (hit && Date.now() - hit.cachedAt < this.ttlMs) return hit;

    const club = await this.prisma.club.findFirst({
      where: { id: clubId, deletedAt: null },
      select: {
        timezone: true,
        currency: true,
        locale: true,
        settings: true,
      },
    });

    if (!club) throw new NotFoundException('Club no encontrado');

    const entry: CachedClub = {
      timezone: club.timezone,
      currency: club.currency,
      locale: club.locale,
      settings: (club.settings ?? {}) as Record<string, unknown>,
      cachedAt: Date.now(),
    };

    this.cache.set(clubId, entry);
    return entry;
  }

  async timezone(clubId: string): Promise<string> {
    return (await this.get(clubId)).timezone;
  }

  /** Llamar tras actualizar la configuración del club. */
  invalidate(clubId: string): void {
    this.cache.delete(clubId);
  }
}
