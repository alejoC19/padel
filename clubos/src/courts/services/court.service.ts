import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PlanLimitsService } from '../../common/services/plan-limits.service';
import type { CreateCourtDto, UpdateCourtDto } from '../dto/court.dto';

const COURT_SELECT = {
  id: true, sportId: true, name: true, number: true, environment: true,
  surface: true, hasLighting: true, capacity: true, color: true,
  status: true, slotMinutes: true, features: true, sortOrder: true,
};

@Injectable()
export class CourtService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limits: PlanLimitsService,
  ) {}

  async list() {
    return this.prisma.db.court.findMany({
      where: { deletedAt: null },
      select: COURT_SELECT,
      orderBy: { sortOrder: 'asc' },
    });
  }

  async create(dto: CreateCourtDto, clubId: string) {
    // Enforcement real del límite del plan — ver PlanLimitsService.
    const currentCount = await this.prisma.db.court.count({
      where: { deletedAt: null },
    });
    await this.limits.assertCanAdd(clubId, 'maxCourts', currentCount, 'canchas');

    const sport = await this.prisma.db.sport.findFirst({
      where: { id: dto.sportId, deletedAt: null },
      select: { id: true },
    });
    if (!sport) throw new NotFoundException('Deporte no encontrado.');

    try {
      return await this.prisma.db.court.create({
        data: {
          clubId,
          sportId: dto.sportId,
          name: dto.name.trim(),
          number: dto.number,
          environment: dto.environment as never,
          surface: dto.surface as never,
          hasLighting: dto.hasLighting,
          capacity: dto.capacity,
          color: dto.color,
          slotMinutes: dto.slotMinutes,
          features: dto.features ?? [],
        },
        select: COURT_SELECT,
      });
    } catch (e) {
      // @@unique([clubId, number])
      if (this.isUniqueViolation(e)) {
        throw new ConflictException(
          `Ya existe una cancha número ${dto.number}. Elegí otro número.`,
        );
      }
      throw e;
    }
  }

  async update(id: string, dto: UpdateCourtDto) {
    const court = await this.prisma.db.court.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!court) throw new NotFoundException('Cancha no encontrada.');

    return this.prisma.db.court.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.status !== undefined ? { status: dto.status as never } : {}),
        ...(dto.environment !== undefined ? { environment: dto.environment as never } : {}),
        ...(dto.surface !== undefined ? { surface: dto.surface as never } : {}),
        ...(dto.hasLighting !== undefined ? { hasLighting: dto.hasLighting } : {}),
        ...(dto.capacity !== undefined ? { capacity: dto.capacity } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
        ...(dto.slotMinutes !== undefined ? { slotMinutes: dto.slotMinutes } : {}),
        ...(dto.features !== undefined ? { features: dto.features } : {}),
      },
      select: COURT_SELECT,
    });
  }

  /**
   * Soft delete. No se borra si tiene reservas futuras activas: perderían
   * su cancha de un día para el otro sin que nadie se entere.
   */
  async remove(id: string): Promise<void> {
    const court = await this.prisma.db.court.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!court) throw new NotFoundException('Cancha no encontrada.');

    const futureBooking = await this.prisma.db.booking.findFirst({
      where: {
        courtId: id,
        deletedAt: null,
        endsAt: { gte: new Date() },
        status: { notIn: ['CANCELLED_BY_CLIENT', 'CANCELLED_BY_CLUB', 'NO_SHOW'] },
      },
      select: { id: true },
    });
    if (futureBooking) {
      throw new ConflictException(
        'Esta cancha tiene reservas futuras. Cancelalas o reprogramalas antes de darla de baja.',
      );
    }

    await this.prisma.db.court.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'DISABLED' },
    });
  }

  private isUniqueViolation(e: unknown): boolean {
    return (
      typeof e === 'object' &&
      e !== null &&
      'code' in e &&
      (e as { code: unknown }).code === 'P2002'
    );
  }
}
