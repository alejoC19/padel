import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DocumentNumberService } from '../../bookings/services/document-number.service';

/**
 * Gastos y proveedores.
 *
 * ---------------------------------------------------------------------------
 * UN GASTO NO ES UN MOVIMIENTO DE CAJA
 * ---------------------------------------------------------------------------
 * Son dos cosas separadas y confundirlas rompe el flujo de fondos:
 *
 *   Expense       — la obligación: la factura del proveedor con su vencimiento
 *   CashMovement  — el pago: la plata que sale del cajón
 *
 * Una factura de luz que vence el 15 es un gasto desde que llega, aunque se
 * pague el 14. Registrarla solo cuando se paga hace que la proyección no la
 * vea y el club se lleve la sorpresa.
 *
 * Por eso `registerExpense` no toca la caja, y `payExpense` es una operación
 * aparte que sí lo hace.
 * ---------------------------------------------------------------------------
 */
@Injectable()
export class ExpenseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly docNumber: DocumentNumberService,
  ) {}

  /** Registra la obligación. No mueve plata. */
  async registerExpense(
    input: {
      clubId: string;
      concept: string;
      amount: number;
      taxAmount?: number;
      date: string;
      dueDate?: string;
      categoryId?: string;
      supplierId?: string;
      documentType?: string;
      documentNumber?: string;
      description?: string;
      createdById?: string | null;
    },
  ) {
    if (input.amount <= 0) {
      throw new BadRequestException('El monto debe ser mayor a cero.');
    }
    if (input.dueDate && input.dueDate < input.date) {
      throw new BadRequestException(
        'El vencimiento no puede ser anterior a la fecha del comprobante.',
      );
    }

    return this.prisma.tenantTransaction(async (tx) => {
      const { code } = await this.docNumber.next(tx, input.clubId, 'EXPENSE');

      const expense = await tx.expense.create({
        data: {
          clubId: input.clubId,
          code,
          concept: input.concept,
          description: input.description ?? null,
          amount: input.amount,
          taxAmount: input.taxAmount ?? 0,
          total: this.round(input.amount + (input.taxAmount ?? 0)),
          date: new Date(`${input.date}T00:00:00Z`),
          dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00Z`) : null,
          categoryId: input.categoryId ?? null,
          supplierId: input.supplierId ?? null,
          documentType: input.documentType ?? null,
          documentNumber: input.documentNumber ?? null,
          status: 'PENDING',
          createdById: input.createdById ?? null,
        },
        select: { id: true, code: true, total: true, dueDate: true },
      });

      // El saldo del proveedor sube: se le debe.
      if (input.supplierId) {
        await tx.supplier.update({
          where: { id: input.supplierId },
          data: { currentBalance: { increment: this.round(input.amount + (input.taxAmount ?? 0)) } },
        });
      }

      return {
        id: expense.id,
        code: expense.code,
        total: this.num(expense.total),
        dueDate: expense.dueDate,
      };
    });
  }

  /**
   * Paga un gasto: acá sí sale la plata.
   *
   * Si el pago es en efectivo exige caja abierta, igual que un cobro: el
   * dinero que sale del cajón tiene que aparecer en el arqueo o el cierre
   * no cuadra.
   */
  async payExpense(
    expenseId: string,
    input: {
      clubId: string;
      paymentMethodId?: string;
      cashSessionId?: string;
      bankAccountId?: string;
      createdById?: string | null;
    },
  ) {
    return this.prisma.tenantTransaction(async (tx) => {
      const expense = await tx.expense.findFirst({
        where: { id: expenseId, deletedAt: null },
        select: {
          id: true, code: true, concept: true, total: true,
          status: true, supplierId: true,
        },
      });

      if (!expense) throw new NotFoundException('Gasto no encontrado');
      if (expense.status === 'PAID') {
        throw new ConflictException('El gasto ya está pagado.');
      }
      if (expense.status === 'CANCELLED') {
        throw new ConflictException('El gasto está anulado.');
      }

      const total = this.num(expense.total);

      // Pago en efectivo: sale del cajón y tiene que verse en el arqueo.
      if (input.paymentMethodId) {
        const method = await tx.paymentMethod.findFirst({
          where: { id: input.paymentMethodId, deletedAt: null },
          select: { id: true, affectsCashCount: true, name: true },
        });
        if (!method) throw new NotFoundException('Medio de pago no encontrado');

        if (method.affectsCashCount) {
          const session = input.cashSessionId
            ? await tx.cashSession.findFirst({
                where: { id: input.cashSessionId, status: 'OPEN' },
                select: { id: true },
              })
            : await tx.cashSession.findFirst({
                where: { status: 'OPEN' },
                select: { id: true },
              });

          if (!session) {
            throw new ConflictException(
              'No hay una caja abierta. Abrí la caja para pagar en efectivo.',
            );
          }

          await tx.cashMovement.create({
            data: {
              clubId: input.clubId,
              sessionId: session.id,
              type: 'EXPENSE',
              direction: 'OUT',
              amount: total,
              paymentMethodId: method.id,
              concept: `${expense.concept} (${expense.code})`,
              reference: expense.id,
              createdById: input.createdById ?? null,
            },
          });
        }
      }

      // Pago por transferencia: baja el saldo del banco.
      if (input.bankAccountId) {
        await tx.bankAccount.update({
          where: { id: input.bankAccountId },
          data: { currentBalance: { decrement: total } },
        });
      }

      await tx.expense.update({
        where: { id: expense.id },
        data: { status: 'PAID', paidAt: new Date() },
      });

      if (expense.supplierId) {
        await tx.supplier.update({
          where: { id: expense.supplierId },
          data: { currentBalance: { decrement: total } },
        });
      }

      return { code: expense.code, paid: total };
    });
  }

  /** Gastos pendientes, ordenados por urgencia de vencimiento. */
  async listPending() {
    const rows = await this.prisma.tenantQueryRaw<Array<Record<string, unknown>>>(`
      SELECT
        e.id, e.code, e.concept, e.total, e.date, e."dueDate", e.status,
        s.name AS supplier, ec.name AS category,
        CASE
          WHEN e."dueDate" IS NULL THEN NULL
          ELSE (e."dueDate" - CURRENT_DATE)
        END AS days_to_due
      FROM expenses e
      LEFT JOIN suppliers s ON s.id = e."supplierId"
      LEFT JOIN expense_categories ec ON ec.id = e.categoryId
      WHERE e."clubId" = current_club_id()
        AND e."deletedAt" IS NULL
        AND e.status IN ('PENDING','PARTIALLY_PAID')
      ORDER BY e."dueDate" ASC NULLS LAST, e.date ASC
      LIMIT 200
    `);

    return rows.map((r) => {
      const daysToDue = r.days_to_due !== null ? Number(r.days_to_due) : null;
      return {
        id: String(r.id),
        code: String(r.code),
        concept: String(r.concept),
        total: this.num(r.total),
        date: r.date as Date,
        dueDate: (r.dueDate as Date) ?? null,
        supplier: r.supplier ? String(r.supplier) : null,
        category: r.category ? String(r.category) : null,
        daysToDue,
        isOverdue: daysToDue !== null && daysToDue < 0,
      };
    });
  }

  /** Gastos por categoría en un período: dónde se va la plata. */
  async getByCategory(from: string, to: string) {
    const rows = await this.prisma.tenantQueryRaw<Array<Record<string, unknown>>>(
      `
      SELECT
        COALESCE(ec.name, 'Sin categoría') AS category,
        ec."isFixed",
        COUNT(*)::int AS count,
        COALESCE(SUM(e.total), 0)::numeric AS total
      FROM expenses e
      LEFT JOIN expense_categories ec ON ec.id = e.categoryId
      WHERE e."clubId" = current_club_id()
        AND e."deletedAt" IS NULL
        AND e.status <> 'CANCELLED'
        AND e.date >= $1::date AND e.date <= $2::date
      GROUP BY ec.name, ec."isFixed"
      ORDER BY total DESC
      `,
      from,
      to,
    );

    const total = rows.reduce((s, r) => s + this.num(r.total), 0);

    return {
      total: this.round(total),
      // Separar fijos de variables es lo que permite calcular el punto de
      // equilibrio: cuánto hay que facturar para cubrir lo que se paga sí o sí.
      fixed: this.round(
        rows.filter((r) => r.isFixed === true).reduce((s, r) => s + this.num(r.total), 0),
      ),
      variable: this.round(
        rows.filter((r) => r.isFixed !== true).reduce((s, r) => s + this.num(r.total), 0),
      ),
      categories: rows.map((r) => ({
        category: String(r.category),
        isFixed: r.isFixed === true,
        count: Number(r.count ?? 0),
        total: this.num(r.total),
        share: total > 0 ? this.round((this.num(r.total) / total) * 100) : 0,
      })),
    };
  }

  // --- proveedores ---

  async listSuppliers() {
    const suppliers = await this.prisma.db.supplier.findMany({
      where: { deletedAt: null },
      select: {
        id: true, name: true, taxId: true, email: true, phone: true,
        currentBalance: true, isActive: true,
      },
      orderBy: { name: 'asc' },
    });

    return suppliers.map((s: Record<string, unknown>) => ({
      ...s,
      currentBalance: this.num(s.currentBalance),
      // Positivo = se le debe.
      owed: this.num(s.currentBalance) > 0 ? this.num(s.currentBalance) : 0,
    }));
  }

  async createSupplier(input: {
    clubId: string;
    name: string;
    legalName?: string;
    taxId?: string;
    email?: string;
    phone?: string;
    address?: string;
  }) {
    return this.prisma.db.supplier.create({
      data: {
        clubId: input.clubId,
        name: input.name,
        legalName: input.legalName ?? null,
        taxId: input.taxId ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        address: input.address ?? null,
      },
      select: { id: true, name: true },
    });
  }

  private num(v: unknown): number {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'number') return v;
    return Number((v as { toString(): string }).toString());
  }

  private round(n: number): number {
    return Math.round(n * 100) / 100;
  }
}
