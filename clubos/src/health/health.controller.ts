import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public, SkipTenant } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Health checks. Los consume el orquestador del hosting (Railway/Render/Fly/
 * Kubernetes) para saber si la instancia está viva y lista para recibir
 * tráfico. Van SIN prefijo (/health, no /api/v1/health) — así lo excluye
 * main.ts — y sin auth.
 *
 * Dos niveles, distintos a propósito:
 *  - /health   liveness: ¿el proceso responde? No toca la base. Si esto falla,
 *              el orquestador REINICIA la instancia.
 *  - /health/ready  readiness: ¿puede servir tráfico (base OK)? Si falla, el
 *              orquestador la saca del balanceo pero NO la reinicia (la base
 *              podría estar reiniciándose y no tiene sentido matar la app).
 */
@Controller('health')
@Public()
@SkipTenant()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: barato, sin I/O. */
  @Get()
  live() {
    return {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  /** Readiness: incluye dependencias externas (base). */
  @Get('ready')
  async ready() {
    const dbOk = await this.prisma.isHealthy();
    if (!dbOk) {
      // 503: el balanceador lo interpreta como "no enviar tráfico" sin matar
      // el proceso (la base puede estar reiniciándose).
      throw new ServiceUnavailableException({
        status: 'degraded',
        checks: { database: 'down' },
        timestamp: new Date().toISOString(),
      });
    }
    return {
      status: 'ok',
      checks: { database: 'up' },
      timestamp: new Date().toISOString(),
    };
  }
}
