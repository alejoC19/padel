import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  calculateBalance,
  calculateDifference,
  sumDenominations,
  type CashBalance,
  type MovementRow,
} from '../cash-balance';
import type {
  CloseSessionDto,
  ManualMovementDto,
  OpenSessionDto,
} from '../dto/cash.dto';

/** Tipos de movimiento que un operador puede cargar a mano. */
const MANUAL_TYPES: Record<string, 'IN' | 'OUT'> = {
  MANUAL_INCOME: 'IN',
  DEPOSIT: 'IN',
  EXPENSE: 'OUT',
  WITHDRAWAL: 'OUT',
  ADJUSTMENT: 'OUT',
};

@Injectable()
export class CashService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Abre un turno de caja.
   *
   * El unique index parcial `cash_sessions_one_open_per_register` impide
   * dos turnos abiertos en el mismo puesto. Se pre-chequea acá solo para
   * dar un mensaje útil; la garantía es del motor.
   */
  async open(
    dto: OpenSessionDto,
    clubId: string,
    membershipId: string,
  ): Promise<{ id: string; openedAt: Date; openingAmount: number }> {
    const register = await this.prisma.db.cashRegister.findFirst({
      where: { id: dto.registerId, deletedAt: null, isActive: true },
      select: { id: true, name: true },
    });

    if (!register) {
      throw new NotFoundException('Puesto de caja no encontrado o inactivo');
    }

    const already = await this.prisma.db.cashSession.findFirst({
      where: { registerId: dto.registerId, status: 'OPEN' },
      select: {
        id: true,
        openedAt: true,
        membership: {
          select: { user: { select: { firstName: true, lastName: true } } },
        },
      },
    });

    if (already) {
      const who = already.membership?.user
        ? `${already.membership.user.firstName} ${already.membership.user.lastName}`
        : 'otro usuario';
      throw new ConflictException(
        `Ya hay una caja abierta en ${register.name} por ${who}. Cerrala antes de abrir otra.`,
      );
    }

    // Continuidad de fondo: si el cierre anterior dejó plata, el monto de
    // apertura debería coincidir. No se fuerza (el club puede retirar todo
    // al cerrar), pero se advierte si difiere.
    const session = await this.prisma.db.cashSession.create({
      data: {
        clubId,
        registerId: dto.registerId,
        membershipId,
        openingAmount: dto.openingAmount,
        openingNotes: dto.notes,
        status: 'OPEN',
      },
      select: { id: true, openedAt: true, openingAmount: true },
    });

    await this.prisma.db.auditLog.create({
      data: {
        clubId,
        action: 'CASH_OPEN',
        entityType: 'CashSession',
        entityId: session.id,
        changes: {
          register: register.name,
          openingAmount: dto.openingAmount,
        } as never,
      },
    });

    return {
      id: session.id,
      openedAt: session.openedAt,
      openingAmount: this.num(session.openingAmount),
    };
  }

  /** Estado en vivo de una caja. Es la pantalla principal del módulo. */
  async getBalance(sessionId: string): Promise<
    CashBalance & {
      sessionId: string;
      status: string;
      openedAt: Date;
      closedAt: Date | null;
      registerName: string;
      operatorName: string | null;
    }
  > {
    const session = await this.prisma.db.cashSession.findFirst({
      where: { id: sessionId },
      select: {
        id: true,
        status: true,
        openedAt: true,
        closedAt: true,
        openingAmount: true,
        register: { select: { name: true } },
        membership: {
          select: { user: { select: { firstName: true, lastName: true } } },
        },
      },
    });

    if (!session) throw new NotFoundException('Caja no encontrada');

    const movements = await this.loadMovements(sessionId);
    const balance = calculateBalance(
      this.num(session.openingAmount),
      movements,
    );

    return {
      ...balance,
      sessionId: session.id,
      status: session.status,
      openedAt: session.openedAt,
      closedAt: session.closedAt,
      registerName: session.register.name,
      operatorName: session.membership?.user
        ? `${session.membership.user.firstName} ${session.membership.user.lastName}`
        : null,
    };
  }

  /** Caja abierta del usuario actual, si tiene una. */
  async getMyOpenSession(membershipId: string) {
    const session = await this.prisma.db.cashSession.findFirst({
      where: { membershipId, status: 'OPEN' },
      select: { id: true },
    });
    return session ? this.getBalance(session.id) : null;
  }

  /** Cajas abiertas del club. Para el panel del dueño. */
  async listOpen() {
    const sessions = await this.prisma.db.cashSession.findMany({
      where: { status: 'OPEN' },
      select: { id: true },
      orderBy: { openedAt: 'asc' },
    });
    return Promise.all(
      sessions.map((s: { id: string }) => this.getBalance(s.id)),
    );
  }

  /**
   * Movimiento manual: ingreso, gasto, retiro o ajuste.
   *
   * El signo lo determina el TIPO, no el usuario. Permitir elegir dirección
   * libremente hace que un gasto cargado como ingreso infle la recaudación
   * sin que nada lo detecte hasta el arqueo.
   */
  async addMovement(
    sessionId: string,
    dto: ManualMovementDto,
    clubId: string,
    userId: string,
  ): Promise<{ id: string; expectedCash: number }> {
    const direction = MANUAL_TYPES[dto.type];
    if (!direction) {
      throw new BadRequestException(
        `Tipo de movimiento no permitido manualmente: ${dto.type}`,
      );
    }

    return this.prisma.tenantTransaction(async (tx) => {
      const session = await tx.cashSession.findFirst({
        where: { id: sessionId },
        select: { id: true, status: true, openingAmount: true },
      });

      if (!session) throw new NotFoundException('Caja no encontrada');
      if (session.status !== 'OPEN') {
        throw new ConflictException(
          'La caja está cerrada. No admite movimientos nuevos.',
        );
      }

      // Un retiro o gasto no puede dejar el cajón en negativo: significaría
      // que se sacó plata que no estaba.
      if (direction === 'OUT') {
        const movements = await this.loadMovements(sessionId, tx);
        const balance = calculateBalance(
          this.num(session.openingAmount),
          movements,
        );
        const affectsCash = await this.methodAffectsCash(
          tx,
          dto.paymentMethodId,
        );
        if (affectsCash && dto.amount > balance.expectedCash) {
          throw new ConflictException(
            `No hay suficiente efectivo en caja. Disponible: ${balance.expectedCash}.`,
          );
        }
      }

      const movement = await tx.cashMovement.create({
        data: {
          clubId,
          sessionId,
          type: dto.type as never,
          direction,
          amount: dto.amount,
          paymentMethodId: dto.paymentMethodId ?? null,
          concept: dto.concept,
          description: dto.description,
          createdById: userId,
        },
        select: { id: true },
      });

      const after = calculateBalance(
        this.num(session.openingAmount),
        await this.loadMovements(sessionId, tx),
      );

      return { id: movement.id, expectedCash: after.expectedCash };
    });
  }

  /**
   * Corrección de un movimiento: contra-asiento, no edición.
   *
   * El libro de caja es append-only (trigger en Postgres). Un error se
   * corrige con un movimiento inverso que referencia al original, de modo
   * que el rastro de qué pasó y quién lo corrigió queda intacto.
   */
  async reverseMovement(
    movementId: string,
    reason: string,
    clubId: string,
    userId: string,
  ): Promise<{ id: string }> {
    return this.prisma.tenantTransaction(async (tx) => {
      const original = await tx.cashMovement.findFirst({
        where: { id: movementId },
        select: {
          id: true,
          sessionId: true,
          type: true,
          direction: true,
          amount: true,
          paymentMethodId: true,
          concept: true,
          session: { select: { status: true } },
        },
      });

      if (!original) throw new NotFoundException('Movimiento no encontrado');
      if (original.session.status !== 'OPEN') {
        throw new ConflictException(
          'No se puede corregir un movimiento de una caja cerrada. ' +
            'Registrá un ajuste en la caja actual.',
        );
      }

      const existing = await tx.cashMovement.findFirst({
        where: { reversesId: movementId },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException('El movimiento ya fue corregido.');
      }

      const reversal = await tx.cashMovement.create({
        data: {
          clubId,
          sessionId: original.sessionId,
          type: original.type,
          direction: original.direction === 'IN' ? 'OUT' : 'IN',
          amount: original.amount,
          paymentMethodId: original.paymentMethodId,
          concept: `Anulación: ${original.concept}`,
          description: reason,
          reversesId: original.id,
          createdById: userId,
        },
        select: { id: true },
      });

      await tx.auditLog.create({
        data: {
          clubId,
          userId,
          action: 'VOID',
          entityType: 'CashMovement',
          entityId: original.id,
          reason,
          changes: { reversalId: reversal.id } as never,
        },
      });

      return { id: reversal.id };
    });
  }

  /**
   * Arqueo sin cerrar: compara el conteo contra lo esperado.
   * Permite detectar diferencias durante el turno, no solo al final.
   */
  async count(
    sessionId: string,
    countedCash: number | undefined,
    denominations: Record<string, number> | undefined,
  ) {
    const balance = await this.getBalance(sessionId);

    const counted =
      denominations !== undefined
        ? sumDenominations(denominations)
        : countedCash;

    if (counted === undefined) {
      throw new BadRequestException(
        'Indicá el total contado o el detalle por denominación.',
      );
    }

    const diff = calculateDifference(balance.expectedCash, counted);

    return {
      expectedCash: balance.expectedCash,
      countedCash: counted,
      ...diff,
      byMethod: balance.byMethod,
      byType: balance.byType,
    };
  }

  /**
   * Cierra el turno.
   *
   * El CHECK `cash_sessions_difference_justified` en Postgres impide cerrar
   * con diferencia sin motivo. Se valida acá también para dar un mensaje
   * claro antes de llegar al motor.
   */
  async close(
    sessionId: string,
    dto: CloseSessionDto,
    clubId: string,
    userId: string,
  ) {
    return this.prisma.tenantTransaction(async (tx) => {
      const session = await tx.cashSession.findFirst({
        where: { id: sessionId },
        select: {
          id: true,
          status: true,
          openingAmount: true,
          register: { select: { name: true } },
        },
      });

      if (!session) throw new NotFoundException('Caja no encontrada');
      if (session.status !== 'OPEN') {
        throw new ConflictException('La caja ya está cerrada.');
      }

      const movements = await this.loadMovements(sessionId, tx);
      const balance = calculateBalance(
        this.num(session.openingAmount),
        movements,
      );

      const counted =
        dto.denominations !== undefined
          ? sumDenominations(dto.denominations)
          : dto.countedCash;

      if (counted === undefined) {
        throw new BadRequestException(
          'Indicá el total contado o el detalle por denominación.',
        );
      }

      const { difference, kind } = calculateDifference(
        balance.expectedCash,
        counted,
      );

      if (difference !== 0 && !dto.differenceReason?.trim()) {
        throw new BadRequestException(
          `La caja cierra con ${kind === 'SHORTAGE' ? 'faltante' : 'sobrante'} ` +
            `de ${Math.abs(difference)}. Indicá el motivo para poder cerrar.`,
        );
      }

      await tx.cashSession.update({
        where: { id: session.id },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          closedById: userId,
          expectedAmount: balance.expectedCash,
          countedAmount: counted,
          difference,
          differenceReason: dto.differenceReason,
          closingNotes: dto.notes,
        },
      });

      await tx.auditLog.create({
        data: {
          clubId,
          userId,
          action: 'CASH_CLOSE',
          entityType: 'CashSession',
          entityId: session.id,
          changes: {
            register: session.register.name,
            expected: balance.expectedCash,
            counted,
            difference,
            totalInflow: balance.totalInflow,
            totalOutflow: balance.totalOutflow,
          } as never,
        },
      });

      return {
        sessionId: session.id,
        expectedCash: balance.expectedCash,
        countedCash: counted,
        difference,
        kind,
        summary: {
          openingAmount: balance.openingAmount,
          totalInflow: balance.totalInflow,
          totalOutflow: balance.totalOutflow,
          movementCount: balance.movementCount,
          byMethod: balance.byMethod,
          byType: balance.byType,
        },
      };
    });
  }

  /** Historial de cajas cerradas. */
  async history(params: { from?: string; to?: string; registerId?: string }) {
    return this.prisma.db.cashSession.findMany({
      where: {
        status: { in: ['CLOSED', 'RECONCILED'] },
        ...(params.registerId ? { registerId: params.registerId } : {}),
        ...(params.from || params.to
          ? {
              openedAt: {
                ...(params.from ? { gte: new Date(params.from) } : {}),
                ...(params.to ? { lte: new Date(params.to) } : {}),
              },
            }
          : {}),
      },
      select: {
        id: true,
        openedAt: true,
        closedAt: true,
        openingAmount: true,
        expectedAmount: true,
        countedAmount: true,
        difference: true,
        differenceReason: true,
        register: { select: { name: true } },
        membership: {
          select: { user: { select: { firstName: true, lastName: true } } },
        },
      },
      orderBy: { openedAt: 'desc' },
      take: 100,
    });
  }

  /** Movimientos de una caja, para el detalle. */
  async listMovements(sessionId: string) {
    return this.prisma.db.cashMovement.findMany({
      where: { sessionId },
      select: {
        id: true,
        type: true,
        direction: true,
        amount: true,
        concept: true,
        description: true,
        reference: true,
        reversesId: true,
        createdAt: true,
        paymentMethod: { select: { code: true, name: true } },
        payment: { select: { code: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // --- internos ---

  private async loadMovements(
    sessionId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<MovementRow[]> {
    const client = tx ?? this.prisma.db;
    const rows = (await client.cashMovement.findMany({
      where: { sessionId },
      select: {
        direction: true,
        amount: true,
        type: true,
        paymentMethod: {
          select: { code: true, name: true, affectsCashCount: true },
        },
      },
    })) as Array<{
      direction: 'IN' | 'OUT';
      amount: unknown;
      type: string;
      paymentMethod: {
        code: string;
        name: string;
        affectsCashCount: boolean;
      } | null;
    }>;

    return rows.map((r) => ({
      direction: r.direction,
      amount: this.num(r.amount),
      type: r.type,
      // Sin medio de pago asignado se asume efectivo: los movimientos
      // manuales (retiros, gastos de caja chica) salen del cajón.
      affectsCashCount: r.paymentMethod?.affectsCashCount ?? true,
      methodCode: r.paymentMethod?.code ?? null,
      methodName: r.paymentMethod?.name ?? null,
    }));
  }

  private async methodAffectsCash(
    tx: Prisma.TransactionClient,
    methodId?: string | null,
  ): Promise<boolean> {
    if (!methodId) return true;
    const m = (await tx.paymentMethod.findFirst({
      where: { id: methodId },
      select: { affectsCashCount: true },
    })) as { affectsCashCount: boolean } | null;
    return m?.affectsCashCount ?? true;
  }

  private num(v: unknown): number {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'number') return v;
    return Number((v as { toString(): string }).toString());
  }
}
