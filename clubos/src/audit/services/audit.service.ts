import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ListAuditLogsDto } from '../dto/audit.dto';

/**
 * Lectura del historial de auditoría.
 *
 * Las escrituras ya existían y son consistentes (caja, clientes, reservas,
 * tesorería, pos, staff, expiración de trial), pero nada las exponía: el
 * permiso `audit.view` estaba declarado sin ningún controller detrás. Los
 * datos se estaban capturando para nadie.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(clubId: string, q: ListAuditLogsDto) {
    const take = Math.min(q.limit ?? 50, 100);
    const skip = q.offset ?? 0;

    const where: Record<string, unknown> = { clubId };
    if (q.action) where.action = q.action;
    if (q.entityType) where.entityType = q.entityType;
    if (q.userId) where.userId = q.userId;
    if (q.from || q.to) {
      where.createdAt = {
        ...(q.from ? { gte: new Date(q.from) } : {}),
        ...(q.to ? { lte: new Date(q.to) } : {}),
      };
    }

    const [items, total] = await Promise.all([
      this.prisma.db.auditLog.findMany({
        where: where as never,
        select: {
          id: true, action: true, entityType: true, entityId: true,
          changes: true, reason: true, createdAt: true,
          user: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.db.auditLog.count({ where: where as never }),
    ]);

    return { items, total, limit: take, offset: skip };
  }
}
