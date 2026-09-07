import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

type LimitField = 'maxCourts' | 'maxUsers' | 'maxClients';

/**
 * Enforcement real de los límites del plan.
 *
 * `Plan.maxCourts/maxUsers/maxClients` existían en el schema desde siempre,
 * pero nada los leía: un club en el plan Starter podía crear canchas,
 * usuarios o clientes sin tope alguno. Confiar en que el frontend no
 * muestre el botón de "agregar" no es un límite — es una sugerencia.
 *
 * `-1` en el plan significa ilimitado (documentado en el schema).
 */
@Injectable()
export class PlanLimitsService {
  constructor(private readonly prisma: PrismaService) {}

  async assertCanAdd(
    clubId: string,
    field: LimitField,
    currentCount: number,
    resourceLabel: string,
  ): Promise<void> {
    // Club es un modelo de plataforma (sin RLS): se puede leer directo.
    const club = await this.prisma.db.club.findUnique({
      where: { id: clubId },
      select: { plan: { select: { [field]: true, name: true } } },
    });

    const limit = (club?.plan as Record<string, unknown> | undefined)?.[field] as
      | number
      | undefined;
    if (limit === undefined || limit === -1) return;

    if (currentCount >= limit) {
      throw new ForbiddenException(
        `Tu plan (${club?.plan?.name ?? 'actual'}) permite hasta ${limit} ${resourceLabel}. ` +
          'Para agregar más, mejorá tu plan.',
      );
    }
  }
}
