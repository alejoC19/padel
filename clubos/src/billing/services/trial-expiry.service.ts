import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { runWithoutTenancy, runWithTenant } from '../../tenancy/tenant-context';

/**
 * Vence los trials.
 *
 * `Club.trialEndsAt` existía desde siempre pero nada lo leía: un club en
 * TRIAL seguía operando indefinidamente después de la fecha, porque el
 * único lugar que bloquea acceso (TenantGuard) solo mira
 * `status IN ('SUSPENDED','CANCELLED')` — nunca llegaba a mirar la fecha.
 * "El botón de upgrade no aparece" no es un límite de negocio, es una
 * sugerencia de UI.
 *
 * No hay todavía cobro de suscripción (Mercado Pago acá es para que EL
 * CLUB cobre a SUS jugadores, no para que ClubOS le cobre al club), así que
 * no existe un camino automático de "trial vencido → pagó → vuelve a
 * ACTIVE". Fingir un estado intermedio (PAST_DUE) sin ningún mecanismo real
 * para salir de él sería peor que ser directo: al vencer, el club pasa a
 * SUSPENDED, que es el estado que TenantGuard YA bloquea, con un mensaje
 * claro. Reactivarlo es una acción manual de soporte/plataforma hasta que
 * exista facturación real de la plataforma.
 */
@Injectable()
export class TrialExpiryService {
  private readonly log = new Logger(TrialExpiryService.name);
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  /** Una vez al día alcanza: no es una operación sensible al minuto. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await runWithoutTenancy(randomUUID(), () => this.expireTrials());
    } catch (err) {
      this.log.error(`Fallo venciendo trials: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async expireTrials(): Promise<void> {
    // Club es de plataforma (sin RLS): se puede leer/filtrar directo.
    const expired = await this.prisma.db.club.findMany({
      where: { status: 'TRIAL', trialEndsAt: { lt: new Date() } },
      select: { id: true, slug: true, name: true },
    });

    for (const club of expired) {
      await this.prisma.db.club.update({
        where: { id: club.id },
        data: { status: 'SUSPENDED' },
      });

      // AuditLog SÍ tiene RLS (tiene clubId) — se abre contexto real de ese
      // club puntual para dejar el rastro, no un bypass genérico.
      await runWithTenant(
        {
          clubId: club.id,
          userId: null,
          membershipId: null,
          roleCode: null,
          permissions: new Set(),
          isPlatformAdmin: true,
          requestId: randomUUID(),
          bypassTenancy: false,
        },
        async () => {
          await this.prisma.db.auditLog.create({
            data: {
              clubId: club.id,
              action: 'UPDATE',
              entityType: 'Club',
              entityId: club.id,
              reason: 'Trial vencido',
              changes: { status: { from: 'TRIAL', to: 'SUSPENDED' } } as never,
            },
          });
        },
      );

      this.log.warn(`Trial vencido: ${club.slug} (${club.name}) → SUSPENDED.`);
    }
  }
}
