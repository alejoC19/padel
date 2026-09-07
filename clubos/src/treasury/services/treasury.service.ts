import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Tesorería: cuentas bancarias y conciliación.
 *
 * ---------------------------------------------------------------------------
 * QUÉ RESUELVE, DISTINTO DE LA CAJA
 * ---------------------------------------------------------------------------
 * La caja responde "¿cuánto efectivo hay en el cajón ahora?". La tesorería
 * responde "¿cuánta plata tiene el club de verdad?" — que incluye lo que está
 * en el banco, lo que Mercado Pago todavía no acreditó y lo que se le debe a
 * los proveedores.
 *
 * Un club puede tener la caja cuadrada y estar fundido: cobró todo con
 * tarjeta a 18 días y tiene que pagar sueldos el viernes.
 *
 * ---------------------------------------------------------------------------
 * IDEMPOTENCIA EN LA IMPORTACIÓN
 * ---------------------------------------------------------------------------
 * Importar el extracto del banco dos veces es el error más común: el
 * administrativo no se acuerda si ya lo hizo, o el archivo se solapa con el
 * del mes anterior. Sin protección, cada importación duplica movimientos y
 * el saldo deja de tener sentido.
 *
 * La huella se calcula sobre fecha + monto + descripción normalizada. Dos
 * movimientos idénticos el mismo día son raros pero existen (dos cobros de
 * $5.000), así que se agrega un discriminador por posición dentro del día.
 * ---------------------------------------------------------------------------
 */

export interface ImportResult {
  imported: number;
  duplicates: number;
  errors: Array<{ line: number; reason: string }>;
  newBalance: number;
}

export interface ReconcileSuggestion {
  transactionId: string;
  date: Date;
  description: string;
  amount: number;
  candidates: Array<{
    kind: 'PAYMENT' | 'EXPENSE';
    id: string;
    code: string;
    amount: number;
    date: Date;
    label: string;
    /** 0..1 — qué tan probable es que sean el mismo movimiento. */
    confidence: number;
    reason: string;
  }>;
}

@Injectable()
export class TreasuryService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // Cuentas
  // -------------------------------------------------------------------------

  async listAccounts() {
    const accounts = await this.prisma.db.bankAccount.findMany({
      where: { deletedAt: null },
      select: {
        id: true, bankName: true, accountName: true, accountType: true,
        cbu: true, alias: true, currency: true, currentBalance: true,
        isActive: true,
      },
      orderBy: { bankName: 'asc' },
    });

    return accounts.map((a: Record<string, unknown>) => ({
      ...a,
      currentBalance: this.num(a.currentBalance),
    }));
  }

  async createAccount(input: {
    clubId: string;
    bankName: string;
    accountName: string;
    accountType?: string;
    cbu?: string;
    alias?: string;
    initialBalance?: number;
  }) {
    return this.prisma.db.bankAccount.create({
      data: {
        clubId: input.clubId,
        bankName: input.bankName,
        accountName: input.accountName,
        accountType: (input.accountType ?? 'CHECKING') as never,
        cbu: input.cbu ?? null,
        alias: input.alias ?? null,
        currentBalance: input.initialBalance ?? 0,
      },
      select: { id: true, bankName: true, accountName: true },
    });
  }

  // -------------------------------------------------------------------------
  // Importación de extracto
  // -------------------------------------------------------------------------

  /**
   * Importa movimientos de un extracto bancario.
   *
   * Las filas duplicadas se saltean en silencio y se reportan al final: el
   * caso normal es reimportar un archivo que se solapa parcialmente con el
   * anterior, y eso no es un error que deba frenar la importación.
   */
  async importStatement(
    clubId: string,
    accountId: string,
    rows: Array<{
      date: string;
      description: string;
      amount: number;
      reference?: string;
      balanceAfter?: number;
    }>,
    source: 'IMPORT_CSV' | 'IMPORT_XLSX' | 'MANUAL' = 'IMPORT_CSV',
  ): Promise<ImportResult> {
    const account = await this.prisma.db.bankAccount.findFirst({
      where: { id: accountId, deletedAt: null },
      select: { id: true, currentBalance: true },
    });
    if (!account) throw new NotFoundException('Cuenta bancaria no encontrada');

    const errors: ImportResult['errors'] = [];
    let imported = 0;
    let duplicates = 0;
    let delta = 0;

    // Contador por huella base, para distinguir movimientos idénticos del
    // mismo día (dos transferencias de $5.000 a la misma hora existen).
    const seenInBatch = new Map<string, number>();

    for (const [index, row] of rows.entries()) {
      const line = index + 1;

      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) {
        errors.push({ line, reason: `Fecha inválida: "${row.date}"` });
        continue;
      }
      if (!Number.isFinite(row.amount) || row.amount === 0) {
        errors.push({ line, reason: 'El monto debe ser un número distinto de cero' });
        continue;
      }
      if (!row.description?.trim()) {
        errors.push({ line, reason: 'Falta la descripción' });
        continue;
      }

      const base = this.fingerprintBase(row.date, row.amount, row.description);
      const occurrence = (seenInBatch.get(base) ?? 0) + 1;
      seenInBatch.set(base, occurrence);
      const fingerprint = `${base}:${occurrence}`;

      try {
        await this.prisma.db.bankTransaction.create({
          data: {
            clubId,
            accountId,
            date: new Date(`${row.date}T00:00:00Z`),
            description: row.description.trim(),
            reference: row.reference ?? null,
            amount: row.amount,
            balanceAfter: row.balanceAfter ?? null,
            fingerprint,
            source: source as never,
          },
        });
        imported++;
        delta += row.amount;
      } catch (e) {
        // El unique (clubId, accountId, fingerprint) rechaza el duplicado.
        // Es el caso esperado al reimportar, no un error que reportar.
        if (String(e).includes('Unique') || String(e).includes('P2002')) {
          duplicates++;
        } else {
          errors.push({ line, reason: 'No se pudo importar la fila' });
        }
      }
    }

    let newBalance = this.num(account.currentBalance);
    if (delta !== 0) {
      const updated = await this.prisma.db.bankAccount.update({
        where: { id: accountId },
        data: { currentBalance: { increment: delta } },
        select: { currentBalance: true },
      });
      newBalance = this.num(updated.currentBalance);
    }

    return { imported, duplicates, errors, newBalance: this.round(newBalance) };
  }

  /**
   * Huella de un movimiento bancario.
   *
   * La descripción se normaliza porque los bancos cambian espacios y
   * mayúsculas entre exportaciones del mismo movimiento. Sin normalizar,
   * "TRANSF. RECIBIDA" y "Transf. Recibida" serían movimientos distintos y
   * el duplicado pasaría.
   */
  private fingerprintBase(date: string, amount: number, description: string): string {
    const normalized = description
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ');

    return createHash('sha256')
      .update(`${date}|${amount.toFixed(2)}|${normalized}`)
      .digest('hex')
      .slice(0, 32);
  }

  // -------------------------------------------------------------------------
  // Conciliación
  // -------------------------------------------------------------------------

  /**
   * Sugiere con qué cobro o gasto se corresponde cada movimiento bancario.
   *
   * No concilia sola: propone y el administrativo confirma. Una conciliación
   * automática que se equivoca es peor que ninguna, porque el error queda
   * enterrado y aparece meses después.
   *
   * El puntaje combina tres señales: monto exacto, cercanía de fechas y
   * coincidencia de texto. El monto pesa más porque es lo único que no
   * varía entre el sistema y el banco.
   */
  async getSuggestions(
    accountId: string,
    limit = 25,
  ): Promise<ReconcileSuggestion[]> {
    const pending = await this.prisma.db.bankTransaction.findMany({
      where: { accountId, isReconciled: false },
      select: { id: true, date: true, description: true, amount: true },
      orderBy: { date: 'desc' },
      take: Math.min(limit, 100),
    });

    if (pending.length === 0) return [];

    const dates = pending.map((t: { date: Date }) => t.date.getTime());
    const from = new Date(Math.min(...dates) - 5 * 86_400_000);
    const to = new Date(Math.max(...dates) + 5 * 86_400_000);

    const [payments, expenses] = await Promise.all([
      this.prisma.db.payment.findMany({
        where: {
          paidAt: { gte: from, lte: to },
          status: { in: ['COMPLETED', 'PARTIALLY_REFUNDED'] },
          settledAt: null,
        },
        select: {
          id: true, code: true, amount: true, netAmount: true, paidAt: true,
          method: { select: { name: true, kind: true } },
          client: { select: { firstName: true, lastName: true } },
        },
        take: 500,
      }),
      this.prisma.db.expense.findMany({
        where: {
          date: { gte: from, lte: to },
          status: { in: ['PENDING', 'PAID'] },
          deletedAt: null,
        },
        select: {
          id: true, code: true, total: true, date: true, concept: true,
          supplier: { select: { name: true } },
        },
        take: 500,
      }),
    ]);

    return pending.map((tx: {
      id: string; date: Date; description: string; amount: unknown;
    }) => {
      const amount = this.num(tx.amount);
      const candidates: ReconcileSuggestion['candidates'] = [];

      // Entradas: se buscan cobros. Salidas: se buscan gastos.
      if (amount > 0) {
        for (const p of payments) {
          const pAmount = this.num(p.amount);
          const pNet = this.num(p.netAmount);
          // El banco acredita el NETO (descontada la comisión), así que se
          // compara contra ambos: bruto por si es efectivo depositado, neto
          // por si es una liquidación de tarjeta.
          const matchesAmount =
            Math.abs(pAmount - amount) < 0.01 || Math.abs(pNet - amount) < 0.01;
          if (!matchesAmount) continue;

          const daysApart = Math.abs(
            (tx.date.getTime() - p.paidAt.getTime()) / 86_400_000,
          );
          const client = p.client
            ? `${p.client.firstName} ${p.client.lastName}`
            : null;

          candidates.push({
            kind: 'PAYMENT',
            id: p.id,
            code: p.code,
            amount: pAmount,
            date: p.paidAt,
            label: `${p.method.name}${client ? ` · ${client}` : ''}`,
            confidence: this.score(daysApart, tx.description, p.method.name, client),
            reason: Math.abs(pNet - amount) < 0.01 && Math.abs(pAmount - amount) >= 0.01
              ? 'Coincide con el neto (comisión descontada)'
              : 'Monto exacto',
          });
        }
      } else {
        const abs = Math.abs(amount);
        for (const e of expenses) {
          if (Math.abs(this.num(e.total) - abs) >= 0.01) continue;
          const daysApart = Math.abs(
            (tx.date.getTime() - e.date.getTime()) / 86_400_000,
          );
          candidates.push({
            kind: 'EXPENSE',
            id: e.id,
            code: e.code,
            amount: this.num(e.total),
            date: e.date,
            label: `${e.concept}${e.supplier ? ` · ${e.supplier.name}` : ''}`,
            confidence: this.score(
              daysApart, tx.description, e.concept, e.supplier?.name ?? null,
            ),
            reason: 'Monto exacto',
          });
        }
      }

      candidates.sort((a, b) => b.confidence - a.confidence);

      return {
        transactionId: tx.id,
        date: tx.date,
        description: tx.description,
        amount,
        candidates: candidates.slice(0, 5),
      };
    });
  }

  /**
   * Puntaje de coincidencia.
   *
   * El monto ya se validó exacto antes de llamar acá, así que esto solo
   * afina entre varios candidatos del mismo monto.
   */
  private score(
    daysApart: number,
    bankDescription: string,
    ...hints: Array<string | null>
  ): number {
    // Mismo día es lo más probable; a más de 5 días, poco confiable.
    const dateScore = daysApart === 0 ? 1 : Math.max(0, 1 - daysApart / 5);

    const desc = this.normalize(bankDescription);
    const textScore = hints.some(
      (h) => h && desc.includes(this.normalize(h).split(' ')[0] ?? ''),
    ) ? 1 : 0;

    // 70% fecha, 30% texto. El texto del banco es ruidoso ("PAGO
    // ELECTRONICO 4829") y no siempre menciona al proveedor.
    return this.round(dateScore * 0.7 + textScore * 0.3);
  }

  private normalize(s: string): string {
    return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  /** Confirma una conciliación propuesta. */
  async reconcile(
    transactionId: string,
    match: { kind: 'PAYMENT' | 'EXPENSE'; id: string },
    clubId: string,
    userId: string,
  ) {
    return this.prisma.tenantTransaction(async (tx) => {
      const bankTx = await tx.bankTransaction.findFirst({
        where: { id: transactionId },
        select: { id: true, isReconciled: true, amount: true, description: true },
      });

      if (!bankTx) throw new NotFoundException('Movimiento bancario no encontrado');
      if (bankTx.isReconciled) {
        throw new ConflictException('El movimiento ya está conciliado.');
      }

      if (match.kind === 'PAYMENT') {
        const payment = await tx.payment.findFirst({
          where: { id: match.id },
          select: { id: true, settledAt: true },
        });
        if (!payment) throw new NotFoundException('El cobro no existe.');
        if (payment.settledAt) {
          throw new ConflictException('Ese cobro ya fue conciliado con otro movimiento.');
        }
        await tx.payment.update({
          where: { id: match.id },
          data: { settledAt: new Date() },
        });
      } else {
        const expense = await tx.expense.findFirst({
          where: { id: match.id, deletedAt: null },
          select: { id: true, status: true },
        });
        if (!expense) throw new NotFoundException('El gasto no existe.');
        await tx.expense.update({
          where: { id: match.id },
          data: { status: 'PAID', paidAt: new Date() },
        });
      }

      await tx.bankTransaction.update({
        where: { id: transactionId },
        data: {
          isReconciled: true,
          reconciledAt: new Date(),
          reconciledWith: match.id,
        },
      });

      await tx.auditLog.create({
        data: {
          clubId, userId, action: 'UPDATE',
          entityType: 'BankTransaction', entityId: transactionId,
          changes: {
            reconciledWith: match.id,
            kind: match.kind,
            amount: this.num(bankTx.amount),
          } as never,
        },
      });

      return { reconciled: true };
    });
  }

  /** Deshace una conciliación mal hecha. */
  async unreconcile(transactionId: string, clubId: string, userId: string) {
    return this.prisma.tenantTransaction(async (tx) => {
      const bankTx = await tx.bankTransaction.findFirst({
        where: { id: transactionId },
        select: { id: true, isReconciled: true, reconciledWith: true },
      });

      if (!bankTx) throw new NotFoundException('Movimiento no encontrado');
      if (!bankTx.isReconciled) {
        throw new ConflictException('El movimiento no está conciliado.');
      }

      // Se revierte el lado del cobro si era un pago; el gasto queda pagado
      // porque desconciliar no significa que no se pagó, solo que el
      // movimiento bancario era otro.
      if (bankTx.reconciledWith) {
        await tx.payment.updateMany({
          where: { id: bankTx.reconciledWith },
          data: { settledAt: null },
        });
      }

      await tx.bankTransaction.update({
        where: { id: transactionId },
        data: { isReconciled: false, reconciledAt: null, reconciledWith: null },
      });

      await tx.auditLog.create({
        data: {
          clubId, userId, action: 'UPDATE',
          entityType: 'BankTransaction', entityId: transactionId,
          reason: 'Conciliación deshecha',
        },
      });

      return { reconciled: false };
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
