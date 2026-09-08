import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AgendaService } from '../bookings/services/agenda.service';
import { ClubConfigService } from '../bookings/services/club-config.service';
import { BookingService } from '../bookings/services/booking.service';
import { PaymentOrderService } from '../payments-gateway/services/payment-order.service';
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
    private readonly orders: PaymentOrderService,
  ) {}

  /**
   * Token de acceso a una reserva pública.
   *
   * 256 bits aleatorios (no adivinable, no derivado de ningún dato de la
   * reserva). Se guarda el hash SHA-256; el crudo se devuelve una única vez
   * (al crear la reserva) y es responsabilidad del jugador guardarlo — es su
   * "comprobante". Reemplaza a "bookingId + teléfono": el teléfono no es un
   * secreto (lo puede saber cualquiera que conozca al jugador o lo intente
   * adivinar dentro del rate-limit), este token sí.
   */
  private generateAccessToken(): { raw: string; hash: string } {
    const raw = randomBytes(32).toString('hex');
    const hash = createHash('sha256').update(raw).digest('hex');
    return { raw, hash };
  }

  private hashAccessToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /** Compara hashes en tiempo constante (evita timing attacks de fuerza bruta). */
  private tokensMatch(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }

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
        // null = la cancha no abre este día. Sin esto el front no tiene forma
        // de saber el horario real del club y termina inventando uno propio
        // (lo que hacía antes): mostraba turnos como disponibles que el
        // backend rechazaba después con 409 al confirmar.
        openMinute: c.openMinute,
        closeMinute: c.closeMinute,
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

      // Token de acceso: se genera acá (no en BookingService, que también
      // sirve al panel donde esto no aplica) y se guarda el hash. El crudo
      // se devuelve UNA sola vez en esta respuesta.
      const { raw: accessToken, hash: accessTokenHash } = this.generateAccessToken();
      await this.prisma.db.booking.update({
        where: { id: result.id },
        data: { accessTokenHash },
      });

      return {
        ok: true,
        booking: {
          id: result.id,
          code: result.code,
          totalPrice: result.totalPrice,
          accessToken,
        },
      };
    });
  }

  /**
   * Reservas de un jugador, identificado por su teléfono.
   *
   * Sin cuenta ni login: la app guarda el teléfono en el celular y pregunta
   * "¿qué reservó este teléfono?". Devuelve las reservas de hoy en adelante.
   *
   * OJO — el teléfono NO es un secreto (lo sabe cualquiera que conozca al
   * jugador, o se puede intentar adivinar dentro del rate-limit). Por eso
   * esta consulta es deliberadamente de bajo valor: ni precio ni el
   * accessToken viajan acá. Para el detalle completo o para cancelar, hace
   * falta el accessToken que se entregó al crear la reserva (ver
   * `consultar`/`cancelar`).
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
          code: true,
          startsAt: true,
          endsAt: true,
          status: true,
          court: { select: { name: true, color: true } },
        },
      });

      return {
        reservas: rows.map((b) => ({
          code: b.code,
          startsAt: b.startsAt,
          endsAt: b.endsAt,
          status: b.status,
          courtName: b.court?.name ?? 'Cancha',
          courtColor: b.court?.color ?? null,
        })),
      };
    });
  }

  /**
   * Detalle completo de una reserva (comprobante), por accessToken.
   *
   * Esta es la vía "segura" para ver precio/estado de pago/etc — a
   * diferencia de `misReservas`, que solo confirma que algo existe.
   */
  async consultar(slug: string, bookingId: string, accessToken: string) {
    const club = await this.resolveClub(slug);
    if (!accessToken?.trim()) {
      throw new NotFoundException('Reserva no encontrada.');
    }

    return runWithTenant(this.publicCtx(club.id), async () => {
      const booking = await this.prisma.db.booking.findFirst({
        where: { id: bookingId },
        select: {
          id: true,
          code: true,
          startsAt: true,
          endsAt: true,
          status: true,
          paymentStatus: true,
          totalPrice: true,
          paidAmount: true,
          accessTokenHash: true,
          court: { select: { name: true, color: true } },
        },
      });
      this.assertOwnsToken(booking, accessToken);

      return {
        id: booking!.id,
        code: booking!.code,
        startsAt: booking!.startsAt,
        endsAt: booking!.endsAt,
        status: booking!.status,
        paymentStatus: booking!.paymentStatus,
        totalPrice: Number(booking!.totalPrice),
        paidAmount: Number(booking!.paidAmount),
        courtName: booking!.court?.name ?? 'Cancha',
        courtColor: booking!.court?.color ?? null,
      };
    });
  }

  /**
   * Checkout online de una reserva pública: crea la orden en Mercado Pago
   * (reusando PaymentOrderService, el mismo camino que usa el panel) y
   * devuelve el link de Checkout Pro al que redirigir al jugador.
   *
   * Gated por accessToken, igual que `consultar`/`cancelar` — no alcanza con
   * el bookingId.
   */
  async checkout(slug: string, bookingId: string, accessToken: string) {
    const club = await this.resolveClub(slug);
    if (!accessToken?.trim()) {
      throw new BadRequestException('Falta el token de acceso de la reserva.');
    }

    return runWithTenant(this.publicCtx(club.id), async () => {
      const booking = await this.prisma.db.booking.findFirst({
        where: { id: bookingId },
        select: { id: true, accessTokenHash: true },
      });
      this.assertOwnsToken(booking, accessToken);

      const { initPoint } = await this.orders.createForBooking({
        clubId: club.id,
        bookingId,
      });
      return { initPoint };
    });
  }

  /** Tira NotFoundException si el token no corresponde a esta reserva. */
  private assertOwnsToken(
    booking: { accessTokenHash: string | null } | null,
    accessToken: string,
  ): void {
    if (!booking || !booking.accessTokenHash) {
      throw new NotFoundException('Reserva no encontrada.');
    }
    const given = this.hashAccessToken(accessToken.trim());
    if (!this.tokensMatch(given, booking.accessTokenHash)) {
      throw new NotFoundException('Reserva no encontrada.');
    }
  }

  /**
   * Cancela una reserva del jugador.
   *
   * Verifica que quien pide la cancelación tenga el accessToken que se le
   * entregó al crear la reserva (no el teléfono — no es un secreto real).
   * Reusa el cancel del panel, que aplica la política de cancelación del
   * club (reembolsos, etc.).
   */
  async cancelar(slug: string, bookingId: string, accessToken: string) {
    const club = await this.resolveClub(slug);
    if (!accessToken?.trim()) {
      throw new BadRequestException('Falta el token de acceso de la reserva.');
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
      const booking = await this.prisma.db.booking.findFirst({
        where: { id: bookingId },
        select: { id: true, accessTokenHash: true },
      });
      this.assertOwnsToken(booking, accessToken);

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

  // ---------------------------------------------------------------------
  // Buffet — menú de solo lectura
  // ---------------------------------------------------------------------

  /**
   * Menú público del buffet: solo nombre, precio y categoría de productos
   * activos vendibles (GOOD/SERVICE). Nada de stock, costo ni datos internos
   * — el jugador solo mira qué hay y cuánto sale, no se pide ni se paga acá.
   */
  async menu(slug: string) {
    const club = await this.resolveClub(slug);

    return runWithTenant(this.publicCtx(club.id), async () => {
      const products = await this.prisma.db.product.findMany({
        where: { clubId: club.id, isActive: true, deletedAt: null },
        select: {
          id: true,
          name: true,
          description: true,
          salePrice: true,
          imageUrl: true,
          category: { select: { name: true, sortOrder: true } },
        },
        orderBy: [{ category: { sortOrder: 'asc' } }, { name: 'asc' }],
      });

      return {
        productos: products.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          price: this.num(p.salePrice),
          category: p.category?.name ?? 'Otros',
          imageUrl: p.imageUrl,
        })),
      };
    });
  }

  // ---------------------------------------------------------------------
  // Torneos — ver e inscribirse
  // ---------------------------------------------------------------------

  /** Torneos con inscripción abierta o próximos a jugarse. */
  async tournaments(slug: string) {
    const club = await this.resolveClub(slug);

    return runWithTenant(this.publicCtx(club.id), async () => {
      const rows = await this.prisma.db.tournament.findMany({
        where: {
          clubId: club.id,
          deletedAt: null,
          status: { in: ['REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'IN_PROGRESS'] },
        },
        select: {
          id: true, name: true, description: true, imageUrl: true,
          format: true, category: true, skillLevel: true,
          startsAt: true, endsAt: true, status: true,
          maxTeams: true, entryFee: true,
          registrationOpensAt: true, registrationClosesAt: true,
          _count: { select: { teams: true } },
        },
        orderBy: { startsAt: 'asc' },
        take: 30,
      });

      return {
        torneos: rows.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          imageUrl: t.imageUrl,
          format: t.format,
          category: t.category,
          skillLevel: t.skillLevel,
          startsAt: t.startsAt,
          endsAt: t.endsAt,
          status: t.status,
          entryFee: this.num(t.entryFee),
          spotsLeft: Math.max(0, t.maxTeams - t._count.teams),
          registrationOpen:
            t.status === 'REGISTRATION_OPEN' &&
            t._count.teams < t.maxTeams &&
            (!t.registrationClosesAt || t.registrationClosesAt > new Date()),
        })),
      };
    });
  }

  /** Detalle de un torneo (equipos ya anotados, sin datos de contacto). */
  async tournamentDetail(slug: string, tournamentId: string) {
    const club = await this.resolveClub(slug);

    return runWithTenant(this.publicCtx(club.id), async () => {
      const t = await this.prisma.db.tournament.findFirst({
        where: { id: tournamentId, clubId: club.id, deletedAt: null },
        select: {
          id: true, name: true, description: true, imageUrl: true,
          format: true, category: true, skillLevel: true,
          startsAt: true, endsAt: true, status: true,
          maxTeams: true, entryFee: true, prizeDescription: true, rules: true,
          registrationOpensAt: true, registrationClosesAt: true,
          teams: {
            select: { id: true, name: true, seed: true },
            orderBy: [{ seed: 'asc' }, { name: 'asc' }],
          },
          _count: { select: { teams: true } },
        },
      });
      if (!t) throw new NotFoundException('Torneo no encontrado.');

      return {
        id: t.id,
        name: t.name,
        description: t.description,
        imageUrl: t.imageUrl,
        format: t.format,
        category: t.category,
        skillLevel: t.skillLevel,
        startsAt: t.startsAt,
        endsAt: t.endsAt,
        status: t.status,
        entryFee: this.num(t.entryFee),
        prizeDescription: t.prizeDescription,
        rules: t.rules,
        spotsLeft: Math.max(0, t.maxTeams - t._count.teams),
        registrationOpen:
          t.status === 'REGISTRATION_OPEN' &&
          t._count.teams < t.maxTeams &&
          (!t.registrationClosesAt || t.registrationClosesAt > new Date()),
        teams: t.teams.map((team) => ({ id: team.id, name: team.name, seed: team.seed })),
      };
    });
  }

  /**
   * Inscribe un equipo desde la app, sin login. Los jugadores dan nombre y
   * teléfono (mismo patrón "invitado" que `reservar`): se busca o crea el
   * Client por teléfono. El equipo queda UNPAID si el torneo cobra
   * inscripción — el jugador paga después con `checkoutInscripcion`.
   */
  async inscribirEquipo(
    slug: string,
    tournamentId: string,
    input: { teamName: string; players: { firstName: string; lastName?: string; phone: string }[] },
  ) {
    const club = await this.resolveClub(slug);

    if (!input.teamName?.trim()) {
      throw new BadRequestException('El equipo necesita un nombre.');
    }
    if (!input.players?.length) {
      throw new BadRequestException('El equipo necesita al menos un jugador.');
    }
    for (const p of input.players) {
      if (!p.firstName?.trim() || !p.phone?.trim()) {
        throw new BadRequestException('Nombre y teléfono son obligatorios para cada jugador.');
      }
    }

    return runWithTenant(this.publicCtx(club.id), async () => {
      return this.prisma.tenantTransaction(async (tx) => {
        const tournament = await tx.tournament.findFirst({
          where: { id: tournamentId, clubId: club.id, deletedAt: null },
          select: {
            id: true, name: true, status: true, maxTeams: true, entryFee: true,
            registrationClosesAt: true,
            _count: { select: { teams: true } },
          },
        });
        if (!tournament) throw new NotFoundException('Torneo no encontrado.');
        if (tournament.status !== 'REGISTRATION_OPEN') {
          throw new BadRequestException('La inscripción está cerrada para este torneo.');
        }
        if (tournament._count.teams >= tournament.maxTeams) {
          throw new BadRequestException(`El torneo está completo (${tournament.maxTeams} equipos).`);
        }
        if (tournament.registrationClosesAt && tournament.registrationClosesAt < new Date()) {
          throw new BadRequestException('El plazo de inscripción venció.');
        }

        // Buscar o crear cada jugador por teléfono, igual que en `reservar`.
        const clientIds: string[] = [];
        for (const p of input.players) {
          let client = await tx.client.findFirst({
            where: { phone: p.phone.trim() },
            select: { id: true },
          });
          if (!client) {
            client = await tx.client.create({
              data: {
                clubId: club.id,
                firstName: p.firstName.trim(),
                lastName: p.lastName?.trim() || '—',
                phone: p.phone.trim(),
              },
              select: { id: true },
            });
          }
          if (!clientIds.includes(client.id)) clientIds.push(client.id);
        }

        const alreadyIn = await tx.tournamentTeamMember.findFirst({
          where: { clientId: { in: clientIds }, team: { tournamentId } },
          select: { client: { select: { firstName: true, lastName: true } } },
        });
        if (alreadyIn) {
          throw new BadRequestException(
            `${alreadyIn.client.firstName} ${alreadyIn.client.lastName} ya está inscripto en este torneo.`,
          );
        }

        const { raw: accessToken, hash: accessTokenHash } = this.generateAccessToken();

        const team = await tx.tournamentTeam.create({
          data: {
            clubId: club.id,
            tournamentId,
            name: input.teamName.trim(),
            seed: tournament._count.teams + 1,
            paymentStatus: 'UNPAID',
            accessTokenHash,
          },
          select: { id: true, name: true },
        });

        await tx.tournamentTeamMember.createMany({
          data: clientIds.map((clientId) => ({ clubId: club.id, teamId: team.id, clientId })),
        });

        return {
          ok: true,
          team: {
            id: team.id,
            name: team.name,
            entryFee: this.num(tournament.entryFee),
            accessToken,
          },
        };
      });
    });
  }

  /** Detalle/comprobante de la inscripción de un equipo, por accessToken. */
  async equipoDetalle(slug: string, teamId: string, accessToken: string) {
    const club = await this.resolveClub(slug);
    if (!accessToken?.trim()) throw new NotFoundException('Equipo no encontrado.');

    return runWithTenant(this.publicCtx(club.id), async () => {
      const team = await this.prisma.db.tournamentTeam.findFirst({
        where: { id: teamId, clubId: club.id },
        select: {
          id: true, name: true, paymentStatus: true, accessTokenHash: true,
          tournament: { select: { id: true, name: true, entryFee: true, startsAt: true } },
          members: { select: { client: { select: { firstName: true, lastName: true } } } },
        },
      });
      this.assertTeamOwnsToken(team, accessToken);

      return {
        id: team!.id,
        name: team!.name,
        paymentStatus: team!.paymentStatus,
        entryFee: this.num(team!.tournament.entryFee),
        tournamentName: team!.tournament.name,
        tournamentStartsAt: team!.tournament.startsAt,
        players: team!.members.map((m) => `${m.client.firstName} ${m.client.lastName}`),
      };
    });
  }

  /**
   * Checkout online (Mercado Pago) de la inscripción de un equipo. Requiere
   * el accessToken del equipo. Mismo patrón que `checkout` de reservas.
   */
  async checkoutInscripcion(slug: string, teamId: string, accessToken: string) {
    const club = await this.resolveClub(slug);
    if (!accessToken?.trim()) {
      throw new BadRequestException('Falta el token de acceso del equipo.');
    }

    return runWithTenant(this.publicCtx(club.id), async () => {
      const team = await this.prisma.db.tournamentTeam.findFirst({
        where: { id: teamId, clubId: club.id },
        select: { id: true, accessTokenHash: true },
      });
      this.assertTeamOwnsToken(team, accessToken);

      const { initPoint } = await this.orders.createForTournamentTeam({
        clubId: club.id,
        teamId,
      });
      return { initPoint };
    });
  }

  /** Tira NotFoundException si el token no corresponde a este equipo. */
  private assertTeamOwnsToken(
    team: { accessTokenHash: string | null } | null,
    accessToken: string,
  ): void {
    if (!team || !team.accessTokenHash) {
      throw new NotFoundException('Equipo no encontrado.');
    }
    const given = this.hashAccessToken(accessToken.trim());
    if (!this.tokensMatch(given, team.accessTokenHash)) {
      throw new NotFoundException('Equipo no encontrado.');
    }
  }

  private num(v: unknown): number {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'number') return v;
    return Number((v as { toString(): string }).toString());
  }
}
