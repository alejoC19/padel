import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AgendaService } from '../bookings/services/agenda.service';
import { ClubConfigService } from '../bookings/services/club-config.service';
import { BookingService } from '../bookings/services/booking.service';
import {
  runWithoutTenancy,
  runWithTenant,
  type TenantContext,
} from '../tenancy/tenant-context';

/**
 * Lógica de los endpoints PÚBLICOS que consume la app del jugador.
 *
 * A diferencia del panel del club (que saca el club del token del staff logueado),
 * acá el club se resuelve por su `slug` en la URL —como cuando entrás a
 * miclub.clubos.com— y NO se pide login. El jugador es un visitante que quiere
 * ver disponibilidad y, más adelante, reservar.
 *
 * Para respetar el aislamiento multi-tenant, una vez resuelto el club se ejecuta
 * la lógica dentro de runWithTenant con un contexto de "solo lectura pública".
 */
@Injectable()
export class PublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agenda: AgendaService,
    private readonly config: ClubConfigService,
    private readonly booking: BookingService,
  ) {}

  /** Resuelve el club por slug (sin tenant, es dato de plataforma). */
  private async resolveClub(slug: string) {
    const club = await runWithoutTenancy(randomUUID(), async () =>
      this.prisma.club.findUnique({
        where: { slug },
        select: { id: true, name: true, slug: true, status: true },
      }),
    );
    // Un club recién creado por onboarding arranca en TRIAL, no ACTIVE —
    // exigir 'ACTIVE' acá dejaba el booking público roto durante los 14 días
    // de prueba de TODO club nuevo, porque nada transiciona TRIAL → ACTIVE
    // automáticamente. Mismo criterio que TenantGuard para el panel: solo
    // SUSPENDED/CANCELLED bloquean.
    const blocked: string[] = ['SUSPENDED', 'CANCELLED'];
    if (!club || blocked.includes(club.status)) {
      throw new NotFoundException('Club no encontrado');
    }
    return club;
  }

  /** Contexto de tenant de solo lectura para el visitante público. */
  private publicCtx(clubId: string): TenantContext {
    return {
      clubId,
      userId: null,
      membershipId: null,
      roleCode: 'PUBLIC',
      permissions: new Set(),
      isPlatformAdmin: false,
      requestId: randomUUID(),
      bypassTenancy: false,
    };
  }

  /** Datos mínimos del club para la cabecera de la app. */
  async getClub(slug: string) {
    const club = await this.resolveClub(slug);
    return { id: club.id, name: club.name, slug: club.slug };
  }

  /**
   * Disponibilidad de un día para la app: canchas + turnos ocupados.
   * Reusa el getDay del panel, pero acotamos lo que se expone al público
   * (no devolvemos datos sensibles del cliente de cada reserva).
   */
  async availability(slug: string, date: string) {
    const club = await this.resolveClub(slug);
    const tz = await runWithTenant(this.publicCtx(club.id), () =>
      this.config.timezone(club.id),
    );

    const day = await runWithTenant(this.publicCtx(club.id), () =>
      this.agenda.getDay(date, tz),
    );

    // Exponer solo lo necesario para mostrar disponibilidad. Nada de nombres
    // ni teléfonos de otros clientes: al jugador solo le importa si está libre.
    return {
      club: { id: club.id, name: club.name, slug: club.slug },
      date,
      courts: day.courts.map((c) => ({
        id: c.id,
        name: c.name,
        number: c.number,
        color: c.color,
        environment: c.environment,
      })),
      busy: day.bookings.map((b) => ({
        courtId: b.courtId,
        startsAt: b.startsAt,
        endsAt: b.endsAt,
      })),
    };
  }

  /**
   * Reserva de un jugador INVITADO (sin cuenta).
   *
   * El jugador da su nombre, teléfono, la cancha, el inicio y la duración.
   * Buscamos si ya existe un cliente con ese teléfono en el club; si no, lo
   * creamos. Después creamos la reserva reusando el BookingService del panel
   * (misma lógica de validación de solapamientos, precio, etc.).
   *
   * La reserva queda registrada como creada por el dueño del club (para la
   * auditoría interna), con origen "online".
   */
  async reservar(
    slug: string,
    input: {
      courtId: string;
      startsAt: string;
      durationMinutes: number;
      firstName: string;
      lastName?: string;
      phone: string;
    },
  ) {
    const club = await this.resolveClub(slug);

    if (!input.firstName?.trim() || !input.phone?.trim()) {
      throw new BadRequestException('Nombre y teléfono son obligatorios.');
    }

    // Duración permitida para reservas online: 60, 90 o 120 minutos.
    const dur = Number(input.durationMinutes);
    if (![60, 90, 120].includes(dur)) {
      throw new BadRequestException('Duración inválida. Elegí 60, 90 o 120 minutos.');
    }

    // No permitir reservar un horario que ya pasó.
    const start = new Date(input.startsAt);
    if (Number.isNaN(start.getTime())) {
      throw new BadRequestException('Horario inválido.');
    }
    if (start.getTime() <= Date.now()) {
      throw new BadRequestException('Ese horario ya pasó. Elegí uno futuro.');
    }

    // Dueño del club: lo usamos como "autor" de la reserva online.
    const owner = await runWithoutTenancy(randomUUID(), async () =>
      this.prisma.db.membership.findFirst({
        where: { clubId: club.id, role: { code: 'OWNER' } },
        select: { userId: true },
      }),
    );
    if (!owner) {
      throw new BadRequestException('El club no tiene un responsable configurado.');
    }

    const ctx = this.publicCtx(club.id);

    return runWithTenant(ctx, async () => {
      // Buscar cliente por teléfono, o crearlo.
      let client = await this.prisma.db.client.findFirst({
        where: { phone: input.phone.trim() },
        select: { id: true },
      });
      if (!client) {
        client = await this.prisma.db.client.create({
          data: {
            clubId: club.id,
            firstName: input.firstName.trim(),
            lastName: input.lastName?.trim() || '—',
            phone: input.phone.trim(),
          },
          select: { id: true },
        });
      }

      const result = await this.booking.create(
        {
          courtId: input.courtId,
          startsAt: input.startsAt,
          durationMinutes: input.durationMinutes,
          clientId: client.id,
        } as Parameters<BookingService['create']>[0],
        club.id,
        owner.userId,
      );

      return {
        ok: true,
        booking: {
          id: result.id,
          code: result.code,
          totalPrice: result.totalPrice,
        },
      };
    });
  }

  /**
   * Reservas de un jugador, identificado por su teléfono.
   *
   * Sin cuenta ni login: la app guarda el teléfono en el celular y pregunta
   * "¿qué reservó este teléfono?". Devuelve las reservas de hoy en adelante,
   * ordenadas por fecha, con los datos de la cancha.
   */
  async misReservas(slug: string, phone: string) {
    const club = await this.resolveClub(slug);
    if (!phone?.trim()) {
      throw new BadRequestException('Falta el teléfono.');
    }

    return runWithTenant(this.publicCtx(club.id), async () => {
      const client = await this.prisma.db.client.findFirst({
        where: { phone: phone.trim() },
        select: { id: true },
      });
      if (!client) return { reservas: [] };

      const now = new Date();
      const rows = await this.prisma.db.booking.findMany({
        where: {
          clientId: client.id,
          endsAt: { gte: now },
          status: { notIn: ['CANCELLED_BY_CLIENT', 'CANCELLED_BY_CLUB'] },
        },
        orderBy: { startsAt: 'asc' },
        select: {
          id: true,
          code: true,
          startsAt: true,
          endsAt: true,
          status: true,
          paymentStatus: true,
          totalPrice: true,
          court: { select: { name: true, color: true } },
        },
      });

      return {
        reservas: rows.map((b) => ({
          id: b.id,
          code: b.code,
          startsAt: b.startsAt,
          endsAt: b.endsAt,
          status: b.status,
          paymentStatus: b.paymentStatus,
          totalPrice: Number(b.totalPrice),
          courtName: b.court?.name ?? 'Cancha',
          courtColor: b.court?.color ?? null,
        })),
      };
    });
  }

  /**
   * Cancela una reserva del jugador.
   *
   * Verifica que la reserva pertenezca al teléfono que la pide (para que nadie
   * cancele reservas ajenas). Reusa el cancel del panel, que aplica la política
   * de cancelación del club (reembolsos, etc.).
   */
  async cancelar(slug: string, bookingId: string, phone: string) {
    const club = await this.resolveClub(slug);
    if (!phone?.trim()) {
      throw new BadRequestException('Falta el teléfono.');
    }

    const owner = await runWithoutTenancy(randomUUID(), async () =>
      this.prisma.db.membership.findFirst({
        where: { clubId: club.id, role: { code: 'OWNER' } },
        select: { userId: true },
      }),
    );
    if (!owner) {
      throw new BadRequestException('El club no tiene un responsable configurado.');
    }

    return runWithTenant(this.publicCtx(club.id), async () => {
      // Verificar que la reserva sea de este teléfono.
      const booking = await this.prisma.db.booking.findFirst({
        where: { id: bookingId },
        select: { id: true, client: { select: { phone: true } } },
      });
      if (!booking || booking.client?.phone !== phone.trim()) {
        throw new NotFoundException('Reserva no encontrada.');
      }

      await this.booking.cancel(
        bookingId,
        { cancelledBy: 'CLIENT', reason: 'Cancelada por el jugador desde la app' } as Parameters<
          BookingService['cancel']
        >[1],
        club.id,
        owner.userId,
      );

      return { ok: true };
    });
  }
}
