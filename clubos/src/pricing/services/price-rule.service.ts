import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreatePriceRuleDto, UpdatePriceRuleDto } from '../dto/price-rule.dto';

const SELECT = {
  id: true,
  courtId: true,
  court: { select: { id: true, name: true } },
  dayOfWeek: true,
  fromMinute: true,
  toMinute: true,
  durationMinutes: true,
  bookingType: true,
  price: true,
  priority: true,
  isActive: true,
  createdAt: true,
};

/**
 * CRUD de reglas de precio.
 *
 * El motor de resolución (PricingService, en bookings/) ya existía y
 * funciona por especificidad — lo que faltaba era una forma de que el club
 * cargue/edite sus propias reglas sin tocar la base a mano. Vive en la
 * sección de Canchas del panel: una tarifa siempre es "de tal cancha en tal
 * horario", así que separarla en una pantalla propia la aleja del contexto
 * donde se decide.
 */
@Injectable()
export class PriceRuleService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const priceList = await this.resolveDefaultPriceList();
    const rules = await this.prisma.db.priceRule.findMany({
      where: { priceListId: priceList.id, deletedAt: null },
      select: SELECT,
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
    return rules.map((r) => ({ ...r, price: this.num(r.price) }));
  }

  async create(dto: CreatePriceRuleDto, clubId: string, userId: string) {
    this.validateWindow(dto.fromMinute ?? null, dto.toMinute ?? null);
    if (dto.courtId) await this.assertCourtExists(dto.courtId);

    const priceList = await this.resolveOrCreateDefaultPriceList(clubId);

    const rule = await this.prisma.db.priceRule.create({
      data: {
        clubId,
        priceListId: priceList.id,
        courtId: dto.courtId ?? null,
        dayOfWeek: dto.dayOfWeek ?? null,
        fromMinute: dto.fromMinute ?? null,
        toMinute: dto.toMinute ?? null,
        durationMinutes: dto.durationMinutes ?? null,
        bookingType: (dto.bookingType ?? null) as never,
        price: dto.price,
        priority: dto.priority ?? 0,
      },
      select: SELECT,
    });

    await this.prisma.db.auditLog.create({
      data: {
        clubId,
        userId,
        action: 'PRICE_CHANGE',
        entityType: 'PriceRule',
        entityId: rule.id,
        changes: { created: true, price: dto.price, courtId: dto.courtId ?? null } as never,
      },
    });

    return { ...rule, price: this.num(rule.price) };
  }

  async update(id: string, dto: UpdatePriceRuleDto, clubId: string, userId: string) {
    const existing = await this.prisma.db.priceRule.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, fromMinute: true, toMinute: true, price: true },
    });
    if (!existing) throw new NotFoundException('Regla de precio no encontrada.');

    const nextFrom = dto.fromMinute !== undefined ? dto.fromMinute : existing.fromMinute;
    const nextTo = dto.toMinute !== undefined ? dto.toMinute : existing.toMinute;
    this.validateWindow(nextFrom, nextTo);

    if (dto.courtId) await this.assertCourtExists(dto.courtId);

    const rule = await this.prisma.db.priceRule.update({
      where: { id },
      data: {
        ...(dto.courtId !== undefined ? { courtId: dto.courtId } : {}),
        ...(dto.dayOfWeek !== undefined ? { dayOfWeek: dto.dayOfWeek } : {}),
        ...(dto.fromMinute !== undefined ? { fromMinute: dto.fromMinute } : {}),
        ...(dto.toMinute !== undefined ? { toMinute: dto.toMinute } : {}),
        ...(dto.durationMinutes !== undefined ? { durationMinutes: dto.durationMinutes } : {}),
        ...(dto.bookingType !== undefined ? { bookingType: dto.bookingType as never } : {}),
        ...(dto.price !== undefined ? { price: dto.price } : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      select: SELECT,
    });

    await this.prisma.db.auditLog.create({
      data: {
        clubId,
        userId,
        action: 'PRICE_CHANGE',
        entityType: 'PriceRule',
        entityId: id,
        changes: {
          ...(dto.price !== undefined
            ? { price: { from: this.num(existing.price), to: dto.price } }
            : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        } as never,
      },
    });

    return { ...rule, price: this.num(rule.price) };
  }

  /**
   * Soft delete. No se puede borrar la última regla activa: sin ninguna,
   * `PricingService.quote()` no tiene nada para cotizar y toda reserva
   * nueva empieza a fallar — un apagón que el club se causa solo, sin
   * ninguna señal previa de que lo estaba haciendo.
   */
  async remove(id: string, clubId: string, userId: string): Promise<void> {
    const existing = await this.prisma.db.priceRule.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, priceListId: true },
    });
    if (!existing) throw new NotFoundException('Regla de precio no encontrada.');

    const activeCount = await this.prisma.db.priceRule.count({
      where: { priceListId: existing.priceListId, deletedAt: null, isActive: true },
    });
    if (activeCount <= 1) {
      throw new ConflictException(
        'No podés borrar la última regla de precios: sin ninguna, las reservas no van a poder cotizarse. Creá otra antes de borrar esta.',
      );
    }

    await this.prisma.db.priceRule.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.prisma.db.auditLog.create({
      data: {
        clubId, userId, action: 'PRICE_CHANGE',
        entityType: 'PriceRule', entityId: id, reason: 'Regla eliminada',
      },
    });
  }

  // --- internos ---

  private async resolveDefaultPriceList() {
    const existing = await this.prisma.db.priceList.findFirst({
      where: { isDefault: true, isActive: true, deletedAt: null },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('El club no tiene una lista de precios configurada.');
    }
    return existing;
  }

  /** Igual que `resolveDefaultPriceList`, pero la crea si nunca existió. */
  private async resolveOrCreateDefaultPriceList(clubId: string) {
    const existing = await this.prisma.db.priceList.findFirst({
      where: { isDefault: true, isActive: true, deletedAt: null },
      select: { id: true },
    });
    if (existing) return existing;

    return this.prisma.db.priceList.create({
      data: { clubId, name: 'General', isDefault: true, isActive: true },
      select: { id: true },
    });
  }

  private async assertCourtExists(courtId: string): Promise<void> {
    const court = await this.prisma.db.court.findFirst({
      where: { id: courtId, deletedAt: null },
      select: { id: true },
    });
    if (!court) throw new NotFoundException('Cancha no encontrada.');
  }

  private validateWindow(from: number | null, to: number | null): void {
    if (from === null || to === null) return;
    if (from >= to) {
      throw new ConflictException('El horario "desde" debe ser anterior al horario "hasta".');
    }
  }

  /** Prisma devuelve Decimal; convertir con precisión de centavos. */
  private num(v: unknown): number {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'number') return v;
    return Number((v as { toString(): string }).toString());
  }
}
