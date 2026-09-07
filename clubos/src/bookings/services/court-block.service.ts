import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateCourtBlockDto } from '../dto/court-block.dto';

/**
 * Bloqueos de cancha: mantenimiento, evento privado, feriado, clima, etc.
 *
 * La reserva doble contra un bloqueo (turno creado encima de un
 * mantenimiento, o dos bloqueos superpuestos) la impide Postgres con el
 * mismo mecanismo que las reservas — un EXCLUDE constraint
 * (`court_blocks_no_overlap`) sobre `[courtId, period]` — no un chequeo acá
 * que pierde ante concurrencia. Este servicio valida lo barato (fechas,
 * que la cancha exista) y deja que el motor arbitre el solapamiento; el
 * filtro global traduce esa violación a un 409 legible.
 */
@Injectable()
export class CourtBlockService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCourtBlockDto, clubId: string, userId: string) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      throw new BadRequestException('Fechas inválidas.');
    }
    if (endsAt <= startsAt) {
      throw new BadRequestException('El fin tiene que ser posterior al inicio.');
    }

    if (dto.courtId) {
      const court = await this.prisma.db.court.findFirst({
        where: { id: dto.courtId, deletedAt: null },
        select: { id: true },
      });
      if (!court) throw new NotFoundException('Cancha no encontrada.');
    }

    const block = await this.prisma.db.courtBlock.create({
      data: {
        clubId,
        courtId: dto.courtId ?? null,
        type: dto.type as never,
        reason: dto.reason,
        description: dto.description,
        startsAt,
        endsAt,
        createdById: userId,
      },
      select: {
        id: true, courtId: true, type: true, reason: true,
        description: true, startsAt: true, endsAt: true,
      },
    });

    return block;
  }

  /** Bloqueos vigentes o futuros (para listarlos en el panel). */
  async list(courtId?: string) {
    return this.prisma.db.courtBlock.findMany({
      where: {
        deletedAt: null,
        endsAt: { gte: new Date() },
        ...(courtId ? { OR: [{ courtId }, { courtId: null }] } : {}),
      },
      select: {
        id: true, courtId: true, type: true, reason: true,
        description: true, startsAt: true, endsAt: true,
        court: { select: { name: true } },
      },
      orderBy: { startsAt: 'asc' },
    });
  }

  /** Levanta un bloqueo antes de que termine (soft delete). */
  async remove(id: string): Promise<void> {
    const block = await this.prisma.db.courtBlock.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!block) throw new NotFoundException('Bloqueo no encontrado.');

    await this.prisma.db.courtBlock.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
