import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ClientSearchService } from './client-search.service';
import type {
  CreateClientDto,
  ListClientsDto,
  UpdateClientDto,
} from '../dto/client.dto';

@Injectable()
export class ClientService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly search: ClientSearchService,
  ) {}

  /**
   * Alta de cliente.
   *
   * Chequea duplicados salvo que el operador confirme explícitamente
   * (`force`). El alta duplicada parte el historial del cliente en dos y
   * después hay que fusionar, que es mucho más caro que prevenir.
   */
  async create(
    dto: CreateClientDto,
    clubId: string,
    userId: string,
  ): Promise<{ id: string; duplicatesFound?: unknown[] }> {
    if (!dto.force) {
      const dupes = await this.search.findPotentialDuplicates(
        {
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone,
          email: dto.email,
          documentNumber: dto.documentNumber,
        },
        clubId,
      );

      // Documento o email iguales: bloquear. Nombre parecido: solo avisar,
      // porque dos "Juan Pérez" distintos existen de verdad.
      const strong = dupes.filter(
        (d) => d.matchedOn === 'documento' || d.matchedOn === 'email',
      );

      if (strong.length > 0) {
        throw new ConflictException({
          message: `Ya existe un cliente con ese ${strong[0].matchedOn}.`,
          code: 'DUPLICATE_CLIENT',
          duplicates: strong,
        });
      }

      if (dupes.length > 0) {
        return {
          id: '',
          duplicatesFound: dupes,
        };
      }
    }

    const client = await this.prisma.db.client.create({
      data: {
        clubId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        documentType: (dto.documentType ?? 'DNI') as never,
        documentNumber: dto.documentNumber,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : null,
        gender: dto.gender as never,
        email: dto.email?.toLowerCase(),
        phone: dto.phone,
        whatsapp: dto.whatsapp ?? dto.phone,
        addressStreet: dto.addressStreet,
        addressCity: dto.addressCity,
        addressZip: dto.addressZip,
        skillLevel: dto.skillLevel as never,
        dominantHand: dto.dominantHand as never,
        preferredSide: dto.preferredSide as never,
        category: dto.category,
        priceListId: dto.priceListId,
        discountPercent: dto.discountPercent ?? 0,
        creditLimit: dto.creditLimit ?? 0,
        acceptsMarketing: dto.acceptsMarketing ?? false,
        acceptsWhatsapp: dto.acceptsWhatsapp ?? true,
      },
      select: { id: true },
    });

    await this.prisma.db.auditLog.create({
      data: {
        clubId,
        userId,
        action: 'CREATE',
        entityType: 'Client',
        entityId: client.id,
        changes: { name: `${dto.firstName} ${dto.lastName}` } as never,
      },
    });

    await this.applyAutoTags(client.id, clubId);

    return { id: client.id };
  }

  async update(
    id: string,
    dto: UpdateClientDto,
    clubId: string,
    userId: string,
  ): Promise<{ id: string }> {
    const existing = await this.prisma.db.client.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, email: true },
    });

    if (!existing) throw new NotFoundException('Cliente no encontrado');

    const data: Record<string, unknown> = {};
    const changes: Record<string, unknown> = {};

    // Solo se escriben los campos presentes: un PATCH parcial no debe
    // borrar datos que el formulario no envió.
    const fields: Array<keyof UpdateClientDto> = [
      'firstName', 'lastName', 'documentNumber', 'phone', 'whatsapp',
      'addressStreet', 'addressCity', 'addressZip', 'category',
      'discountPercent', 'creditLimit', 'acceptsMarketing', 'acceptsWhatsapp',
    ];
    for (const f of fields) {
      if (dto[f] !== undefined) {
        data[f] = dto[f];
        changes[f] = dto[f];
      }
    }
    if (dto.email !== undefined) data.email = dto.email?.toLowerCase() ?? null;
    if (dto.birthDate !== undefined) {
      data.birthDate = dto.birthDate ? new Date(dto.birthDate) : null;
    }
    for (const f of ['documentType','gender','skillLevel','dominantHand','preferredSide','status'] as const) {
      if (dto[f] !== undefined) data[f] = dto[f];
    }
    if (dto.priceListId !== undefined) data.priceListId = dto.priceListId;

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No hay cambios para aplicar.');
    }

    await this.prisma.db.client.update({ where: { id }, data: data as never });

    await this.prisma.db.auditLog.create({
      data: {
        clubId,
        userId,
        action: 'UPDATE',
        entityType: 'Client',
        entityId: id,
        changes: changes as never,
      },
    });

    return { id };
  }

  /** Baja lógica. Nunca se borran datos: el historial debe sobrevivir. */
  async archive(id: string, clubId: string, userId: string): Promise<void> {
    const client = await this.prisma.db.client.findFirst({
      where: { id, deletedAt: null },
      select: { accountBalance: true },
    });

    if (!client) throw new NotFoundException('Cliente no encontrado');

    const balance = this.num(client.accountBalance);
    if (balance < 0) {
      throw new ConflictException(
        `No se puede archivar: el cliente debe ${Math.abs(balance)}. Saldá la cuenta primero.`,
      );
    }

    const future = await this.prisma.db.booking.count({
      where: {
        clientId: id,
        deletedAt: null,
        startsAt: { gt: new Date() },
        status: { in: ['PENDING', 'CONFIRMED', 'PAID'] },
      },
    });

    if (future > 0) {
      throw new ConflictException(
        `No se puede archivar: tiene ${future} reserva(s) futura(s). Cancelalas primero.`,
      );
    }

    await this.prisma.db.client.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'INACTIVE' },
    });

    await this.prisma.db.auditLog.create({
      data: {
        clubId, userId, action: 'DELETE',
        entityType: 'Client', entityId: id,
      },
    });
  }

  /** Ficha completa: lo que ve recepción al abrir un cliente. */
  async getProfile(id: string) {
    const client = await this.prisma.db.client.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true, firstName: true, lastName: true,
        documentType: true, documentNumber: true, birthDate: true,
        gender: true, email: true, phone: true, whatsapp: true,
        addressStreet: true, addressCity: true, addressZip: true,
        avatarUrl: true, skillLevel: true, dominantHand: true,
        preferredSide: true, category: true, status: true,
        clientSince: true, discountPercent: true,
        accountBalance: true, creditLimit: true,
        totalSpent: true, bookingsCount: true, cancellationsCount: true,
        noShowCount: true, lessonsCount: true,
        lastVisitAt: true, lastBookingAt: true, lifetimeValue: true,
        acceptsMarketing: true, acceptsWhatsapp: true,
        priceList: { select: { id: true, name: true } },
        tags: {
          select: {
            tag: { select: { id: true, code: true, name: true, color: true } },
          },
        },
      },
    });

    if (!client) throw new NotFoundException('Cliente no encontrado');

    const [upcoming, recent, memberships] = await Promise.all([
      this.prisma.db.booking.findMany({
        where: {
          clientId: id, deletedAt: null,
          startsAt: { gte: new Date() },
          status: { in: ['PENDING', 'CONFIRMED', 'PAID'] },
        },
        select: {
          id: true, code: true, startsAt: true, endsAt: true,
          status: true, paymentStatus: true, totalPrice: true, paidAmount: true,
          court: { select: { name: true, color: true } },
        },
        orderBy: { startsAt: 'asc' },
        take: 10,
      }),
      this.prisma.db.booking.findMany({
        where: { clientId: id, deletedAt: null, startsAt: { lt: new Date() } },
        select: {
          id: true, code: true, startsAt: true, status: true,
          totalPrice: true, paidAmount: true,
          court: { select: { name: true } },
        },
        orderBy: { startsAt: 'desc' },
        take: 15,
      }),
      this.prisma.db.clientMembership.findMany({
        where: { clientId: id, status: 'ACTIVE' },
        select: {
          id: true, startsAt: true, endsAt: true, hoursUsed: true,
          plan: { select: { name: true, includedHours: true } },
        },
      }),
    ]);

    const stats = this.deriveStats(client);

    return {
      ...client,
      accountBalance: this.num(client.accountBalance),
      creditLimit: this.num(client.creditLimit),
      totalSpent: this.num(client.totalSpent),
      availableCredit: this.round(
        this.num(client.creditLimit) + this.num(client.accountBalance),
      ),
      tags: client.tags.map((t: { tag: unknown }) => t.tag),
      stats,
      upcomingBookings: upcoming,
      recentBookings: recent,
      activeMemberships: memberships,
    };
  }

  /** Listado con filtros. Pantalla principal del CRM. */
  async list(q: ListClientsDto) {
    const take = Math.min(q.limit ?? 50, 100);
    const skip = q.offset ?? 0;

    const where: Record<string, unknown> = { deletedAt: null };

    if (q.status) where.status = q.status;
    if (q.tagCode) {
      where.tags = { some: { tag: { code: q.tagCode } } };
    }
    if (q.debtorsOnly) where.accountBalance = { lt: 0 };
    if (q.inactiveDays) {
      const cutoff = new Date(Date.now() - q.inactiveDays * 86_400_000);
      where.OR = [{ lastVisitAt: { lt: cutoff } }, { lastVisitAt: null }];
    }
    if (q.birthdayMonth) {
      // Prisma no expresa EXTRACT; se resuelve con raw en el índice creado.
      const ids = await this.prisma.db.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM clients
         WHERE club_id = current_club_id() AND deleted_at IS NULL
           AND birth_date IS NOT NULL
           AND EXTRACT(MONTH FROM birth_date) = $1`,
        q.birthdayMonth,
      );
      where.id = { in: ids.map((r: { id: string }) => r.id) };
    }

    const orderBy =
      q.sortBy === 'recent'
        ? [{ lastVisitAt: 'desc' as const }]
        : q.sortBy === 'spent'
          ? [{ totalSpent: 'desc' as const }]
          : [{ lastName: 'asc' as const }, { firstName: 'asc' as const }];

    const [items, total] = await Promise.all([
      this.prisma.db.client.findMany({
        where: where as never,
        select: {
          id: true, firstName: true, lastName: true, phone: true,
          email: true, status: true, accountBalance: true,
          totalSpent: true, bookingsCount: true, lastVisitAt: true,
          avatarUrl: true, skillLevel: true,
          tags: { select: { tag: { select: { code: true, name: true, color: true } } } },
        },
        orderBy,
        take,
        skip,
      }),
      this.prisma.db.client.count({ where: where as never }),
    ]);

    return { items, total, limit: take, offset: skip };
  }

  /**
   * Extracto de cuenta corriente.
   *
   * `balanceAfter` viene guardado en cada asiento, así que el extracto no
   * recalcula nada: se lee y se muestra. Con un cliente de tres años de
   * historial eso es la diferencia entre 5ms y 2 segundos.
   */
  async getAccountStatement(
    clientId: string,
    opts: { from?: string; to?: string; limit?: number } = {},
  ) {
    const client = await this.prisma.db.client.findFirst({
      where: { id: clientId, deletedAt: null },
      select: {
        firstName: true, lastName: true,
        accountBalance: true, creditLimit: true,
      },
    });

    if (!client) throw new NotFoundException('Cliente no encontrado');

    const entries = await this.prisma.db.accountEntry.findMany({
      where: {
        clientId,
        ...(opts.from || opts.to
          ? {
              createdAt: {
                ...(opts.from ? { gte: new Date(opts.from) } : {}),
                ...(opts.to ? { lte: new Date(opts.to) } : {}),
              },
            }
          : {}),
      },
      select: {
        id: true, type: true, amount: true, balanceAfter: true,
        concept: true, dueDate: true, createdAt: true,
        booking: { select: { code: true } },
        payment: { select: { code: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(opts.limit ?? 100, 500),
    });

    const balance = this.num(client.accountBalance);

    return {
      client: {
        name: `${client.firstName} ${client.lastName}`,
        accountBalance: balance,
        creditLimit: this.num(client.creditLimit),
        availableCredit: this.round(this.num(client.creditLimit) + balance),
        // Negativo = debe. Se expone explícito para que la UI no tenga que
        // interpretar el signo.
        owes: balance < 0 ? Math.abs(balance) : 0,
        inFavor: balance > 0 ? balance : 0,
      },
      entries: entries.map((e: Record<string, unknown>) => ({
        ...e,
        amount: this.num(e.amount),
        balanceAfter: this.num(e.balanceAfter),
      })),
    };
  }

  /**
   * Recalcula las etiquetas automáticas de un cliente.
   *
   * Los umbrales son deliberadamente simples y explicables: un dueño de club
   * tiene que poder entender por qué un cliente quedó marcado como "en
   * riesgo". Un modelo de scoring sofisticado que nadie sabe interpretar se
   * ignora en la práctica.
   */
  async applyAutoTags(clientId: string, clubId: string): Promise<string[]> {
    const client = await this.prisma.db.client.findFirst({
      where: { id: clientId, deletedAt: null },
      select: {
        bookingsCount: true, totalSpent: true, lastVisitAt: true,
        clientSince: true, accountBalance: true, cancellationsCount: true,
        noShowCount: true,
      },
    });

    if (!client) return [];

    const now = Date.now();
    const daysSinceVisit = client.lastVisitAt
      ? (now - new Date(client.lastVisitAt).getTime()) / 86_400_000
      : Infinity;
    const daysSinceJoin =
      (now - new Date(client.clientSince).getTime()) / 86_400_000;

    const bookings = client.bookingsCount;
    const spent = this.num(client.totalSpent);
    const balance = this.num(client.accountBalance);

    const codes: string[] = [];

    if (daysSinceJoin <= 30) codes.push('NEW');
    if (bookings >= 20 && spent >= 300_000) codes.push('VIP');
    else if (bookings >= 8 && daysSinceVisit <= 30) codes.push('FREQUENT');

    // Inactivo: 90 días sin venir. En riesgo: era habitual y hace 45 que
    // no aparece — todavía se puede recuperar, que es el punto de marcarlo.
    if (daysSinceVisit > 90) codes.push('INACTIVE');
    else if (bookings >= 5 && daysSinceVisit > 45) codes.push('AT_RISK');

    if (balance < 0) codes.push('DEBTOR');

    const tags = await this.prisma.db.clientTag.findMany({
      where: { code: { in: codes.length ? codes : ['__none__'] }, deletedAt: null },
      select: { id: true, code: true },
    });

    const autoTags = await this.prisma.db.clientTag.findMany({
      where: { isAuto: true, deletedAt: null },
      select: { id: true },
    });
    const autoIds = autoTags.map((t: { id: string }) => t.id);

    await this.prisma.tenantTransaction(async (tx) => {
      // Se limpian solo las automáticas: las que puso un humano se respetan.
      await tx.clientTagAssignment.deleteMany({
        where: { clientId, tagId: { in: autoIds } },
      });
      if (tags.length > 0) {
        await tx.clientTagAssignment.createMany({
          data: tags.map((t: { id: string }) => ({
            clubId, clientId, tagId: t.id,
          })),
          skipDuplicates: true,
        });
      }
    });

    return codes;
  }

  // --- internos ---

  private deriveStats(c: Record<string, unknown>) {
    const bookings = Number(c.bookingsCount ?? 0);
    const cancels = Number(c.cancellationsCount ?? 0);
    const noShows = Number(c.noShowCount ?? 0);
    const attempted = bookings + cancels + noShows;
    const spent = this.num(c.totalSpent);

    return {
      totalBookings: bookings,
      cancellations: cancels,
      noShows,
      // Sobre el total intentado, no sobre las concretadas: si canceló 8 de
      // 10, el ratio relevante es 80%, no 800%.
      cancellationRate: attempted > 0 ? this.round((cancels / attempted) * 100) : 0,
      noShowRate: attempted > 0 ? this.round((noShows / attempted) * 100) : 0,
      averageTicket: bookings > 0 ? this.round(spent / bookings) : 0,
      daysSinceLastVisit: c.lastVisitAt
        ? Math.floor(
            (Date.now() - new Date(c.lastVisitAt as Date).getTime()) / 86_400_000,
          )
        : null,
    };
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
