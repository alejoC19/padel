import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentService } from '../../bookings/services/payment.service';
import {
  calculateStandings, estimateMatches, generateAmericano, generateElimination,
  generateGroups, generateRoundRobin, validateScore,
  type Format, type GeneratedMatch, type SeedTeam,
} from './bracket';

/**
 * Torneos.
 *
 * ---------------------------------------------------------------------------
 * EL FIXTURE SE GENERA UNA VEZ
 * ---------------------------------------------------------------------------
 * Una vez sorteado, el cuadro no se regenera: los equipos ya saben contra
 * quién juegan y a qué hora. Cambiarlo después obliga a avisarle a todos y
 * es la forma más rápida de perder la confianza de los participantes.
 *
 * Si hace falta rehacerlo, se borra explícitamente con `resetFixture`, que
 * solo funciona si no se cargó ningún resultado.
 *
 * ---------------------------------------------------------------------------
 * LA INSCRIPCIÓN COBRA
 * ---------------------------------------------------------------------------
 * Anotar un equipo con `entryFee` genera un cobro real que impacta en caja,
 * igual que una reserva. Un torneo cuyas inscripciones no entran al circuito
 * financiero deja plata fuera del arqueo.
 * ---------------------------------------------------------------------------
 */
@Injectable()
export class TournamentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentService,
  ) {}

  // -------------------------------------------------------------------------
  // Torneo
  // -------------------------------------------------------------------------

  async create(
    input: {
      clubId: string;
      name: string;
      format: Format;
      startsAt: string;
      endsAt?: string;
      maxTeams?: number;
      entryFee?: number;
      category?: string;
      skillLevel?: string;
      description?: string;
      rules?: string;
      prizeDescription?: string;
      registrationOpensAt?: string;
      registrationClosesAt?: string;
    },
  ) {
    const starts = new Date(input.startsAt);
    if (Number.isNaN(starts.getTime())) {
      throw new BadRequestException('Fecha de inicio inválida.');
    }

    return this.prisma.db.tournament.create({
      data: {
        clubId: input.clubId,
        name: input.name,
        format: input.format as never,
        startsAt: starts,
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        maxTeams: input.maxTeams ?? 16,
        entryFee: input.entryFee ?? 0,
        category: input.category ?? null,
        skillLevel: (input.skillLevel ?? null) as never,
        description: input.description ?? null,
        rules: input.rules ?? null,
        prizeDescription: input.prizeDescription ?? null,
        registrationOpensAt: input.registrationOpensAt
          ? new Date(input.registrationOpensAt) : null,
        registrationClosesAt: input.registrationClosesAt
          ? new Date(input.registrationClosesAt) : null,
        status: 'DRAFT',
      },
      select: { id: true, name: true, format: true, startsAt: true, status: true },
    });
  }

  async list(status?: string) {
    const tournaments = await this.prisma.db.tournament.findMany({
      where: { deletedAt: null, ...(status ? { status: status as never } : {}) },
      select: {
        id: true, name: true, format: true, category: true,
        startsAt: true, endsAt: true, status: true,
        maxTeams: true, entryFee: true,
        _count: { select: { teams: true } },
      },
      orderBy: { startsAt: 'desc' },
      take: 50,
    });

    return tournaments.map((t: Record<string, unknown>) => {
      const count = t._count as { teams: number };
      return {
        ...t,
        entryFee: this.num(t.entryFee),
        registeredTeams: count.teams,
        spotsLeft: Number(t.maxTeams) - count.teams,
        _count: undefined,
      };
    });
  }

  async getDetail(tournamentId: string) {
    const tournament = await this.prisma.db.tournament.findFirst({
      where: { id: tournamentId, deletedAt: null },
      select: {
        id: true, name: true, description: true, format: true, category: true,
        skillLevel: true, startsAt: true, endsAt: true, status: true,
        maxTeams: true, entryFee: true, prizeDescription: true, rules: true,
        registrationOpensAt: true, registrationClosesAt: true,
        teams: {
          select: {
            id: true, name: true, seed: true, groupName: true,
            paymentStatus: true, played: true, won: true, lost: true,
            points: true, finalPosition: true,
            members: {
              select: {
                client: {
                  select: { id: true, firstName: true, lastName: true, skillLevel: true },
                },
              },
            },
          },
          orderBy: [{ seed: 'asc' }, { name: 'asc' }],
        },
      },
    });

    if (!tournament) throw new NotFoundException('Torneo no encontrado');

    return {
      ...tournament,
      entryFee: this.num(tournament.entryFee),
      teams: tournament.teams.map((t: Record<string, unknown>) => ({
        ...t,
        members: (t.members as Array<{ client: unknown }>).map((m) => m.client),
      })),
    };
  }

  /**
   * Edita datos del torneo. Solo mientras no tiene fixture: una vez sorteado,
   * los equipos ya coordinaron horarios sobre esos datos (fecha, formato de
   * cobro) y cambiarlos por atrás es la misma razón por la que el fixture no
   * se regenera (ver el comentario de clase). Corregir un typo en el nombre
   * o la fecha antes de sortear es el caso real que esto cubre.
   */
  async update(
    tournamentId: string,
    input: {
      name?: string; startsAt?: string; endsAt?: string; maxTeams?: number;
      entryFee?: number; category?: string; skillLevel?: string;
      description?: string; rules?: string; prizeDescription?: string;
      registrationOpensAt?: string; registrationClosesAt?: string;
    },
  ) {
    const tournament = await this.prisma.db.tournament.findFirst({
      where: { id: tournamentId, deletedAt: null },
      select: { status: true, _count: { select: { matches: true } } },
    });
    if (!tournament) throw new NotFoundException('Torneo no encontrado');
    if (tournament._count.matches > 0) {
      throw new ConflictException(
        'El torneo ya tiene fixture — no se puede editar. Cancelalo si necesitás rehacerlo.',
      );
    }
    if (tournament.status === 'CANCELLED') {
      throw new ConflictException('El torneo está cancelado.');
    }

    if (input.maxTeams !== undefined) {
      const teamCount = await this.prisma.db.tournamentTeam.count({
        where: { tournamentId },
      });
      if (input.maxTeams < teamCount) {
        throw new BadRequestException(
          `Ya hay ${teamCount} equipos inscriptos — no se puede bajar el cupo por debajo de eso.`,
        );
      }
    }

    const starts = input.startsAt ? new Date(input.startsAt) : undefined;
    if (starts && Number.isNaN(starts.getTime())) {
      throw new BadRequestException('Fecha de inicio inválida.');
    }

    return this.prisma.db.tournament.update({
      where: { id: tournamentId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(starts ? { startsAt: starts } : {}),
        ...(input.endsAt !== undefined ? { endsAt: new Date(input.endsAt) } : {}),
        ...(input.maxTeams !== undefined ? { maxTeams: input.maxTeams } : {}),
        ...(input.entryFee !== undefined ? { entryFee: input.entryFee } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.skillLevel !== undefined ? { skillLevel: input.skillLevel as never } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.rules !== undefined ? { rules: input.rules } : {}),
        ...(input.prizeDescription !== undefined ? { prizeDescription: input.prizeDescription } : {}),
        ...(input.registrationOpensAt !== undefined
          ? { registrationOpensAt: new Date(input.registrationOpensAt) } : {}),
        ...(input.registrationClosesAt !== undefined
          ? { registrationClosesAt: new Date(input.registrationClosesAt) } : {}),
      },
      select: { id: true, name: true, format: true, startsAt: true, status: true },
    });
  }

  /**
   * Cancela el torneo. No reembolsa automáticamente las inscripciones
   * pagadas — a diferencia de una reserva, un torneo no tiene una política
   * de cancelación definida (¿se devuelve todo? ¿queda como crédito?) y
   * inventar una acá sería una decisión de producto, no un bug a corregir.
   * El reembolso, si corresponde, se hace a mano desde tesorería/caja.
   */
  async cancel(tournamentId: string) {
    const tournament = await this.prisma.db.tournament.findFirst({
      where: { id: tournamentId, deletedAt: null },
      select: { status: true },
    });
    if (!tournament) throw new NotFoundException('Torneo no encontrado');
    if (tournament.status === 'FINISHED') {
      throw new ConflictException('El torneo ya terminó, no se puede cancelar.');
    }
    if (tournament.status === 'CANCELLED') {
      throw new ConflictException('El torneo ya está cancelado.');
    }

    return this.prisma.db.tournament.update({
      where: { id: tournamentId },
      data: { status: 'CANCELLED' },
      select: { id: true, status: true },
    });
  }

  /**
   * Da de baja un equipo inscripto. Solo antes de que exista el fixture: una
   * vez sorteado, el equipo ocupa un lugar en el cuadro (con horarios y
   * rivales ya definidos) y borrarlo dejaría partidos huérfanos — en ese
   * caso la baja se resuelve como walkover en `recordResult`, no acá.
   */
  async withdrawTeam(tournamentId: string, teamId: string) {
    const team = await this.prisma.db.tournamentTeam.findFirst({
      where: { id: teamId, tournamentId },
      select: {
        id: true,
        _count: { select: { homeMatches: true, awayMatches: true } },
      },
    });
    if (!team) throw new NotFoundException('Equipo no encontrado');
    if (team._count.homeMatches > 0 || team._count.awayMatches > 0) {
      throw new ConflictException(
        'El equipo ya tiene partidos en el fixture — no se puede dar de baja. Cargá el resultado como walkover.',
      );
    }

    await this.prisma.db.tournamentTeam.delete({ where: { id: teamId } });
  }

  // -------------------------------------------------------------------------
  // Inscripción
  // -------------------------------------------------------------------------

  /**
   * Inscribe un equipo y cobra la inscripción.
   *
   * El cobro va por el mismo circuito que una reserva: impacta en caja y en
   * la cuenta del cliente. Un torneo cuya recaudación no entra al arqueo
   * deja plata fuera del control.
   */
  async registerTeam(
    tournamentId: string,
    input: {
      clubId: string;
      name: string;
      clientIds: string[];
      payment?: { paymentMethodId: string; amount: number; cashSessionId?: string };
      createdById?: string | null;
      membershipId?: string | null;
    },
  ) {
    if (input.clientIds.length === 0) {
      throw new BadRequestException('El equipo necesita al menos un jugador.');
    }

    return this.prisma.tenantTransaction(async (tx) => {
      const tournament = await tx.tournament.findFirst({
        where: { id: tournamentId, deletedAt: null },
        select: {
          id: true, name: true, status: true, maxTeams: true, entryFee: true,
          registrationClosesAt: true,
          _count: { select: { teams: true } },
        },
      });

      if (!tournament) throw new NotFoundException('Torneo no encontrado');

      if (!['DRAFT', 'REGISTRATION_OPEN'].includes(tournament.status)) {
        throw new ConflictException(
          'La inscripción está cerrada para este torneo.',
        );
      }
      if (tournament._count.teams >= tournament.maxTeams) {
        throw new ConflictException(
          `El torneo está completo (${tournament.maxTeams} equipos).`,
        );
      }
      if (
        tournament.registrationClosesAt &&
        tournament.registrationClosesAt < new Date()
      ) {
        throw new ConflictException('El plazo de inscripción venció.');
      }

      // Un jugador no puede estar en dos equipos del mismo torneo.
      const alreadyIn = await tx.tournamentTeamMember.findFirst({
        where: {
          clientId: { in: input.clientIds },
          team: { tournamentId },
        },
        select: { client: { select: { firstName: true, lastName: true } } },
      });

      if (alreadyIn) {
        throw new ConflictException(
          `${alreadyIn.client.firstName} ${alreadyIn.client.lastName} ya está inscripto en este torneo.`,
        );
      }

      const team = await tx.tournamentTeam.create({
        data: {
          clubId: input.clubId,
          tournamentId,
          name: input.name,
          seed: tournament._count.teams + 1,
          paymentStatus: 'UNPAID',
        },
        select: { id: true, name: true },
      });

      await tx.tournamentTeamMember.createMany({
        data: input.clientIds.map((clientId) => ({
          clubId: input.clubId,
          teamId: team.id,
          clientId,
        })),
      });

      const fee = this.num(tournament.entryFee);
      let paid = false;

      if (fee > 0 && input.payment) {
        if (input.payment.amount > fee) {
          throw new BadRequestException(
            'El pago supera el valor de la inscripción.',
          );
        }
        await this.payments.register(tx, {
          clubId: input.clubId,
          // El cobro se asocia al primer jugador del equipo.
          clientId: input.clientIds[0] ?? null,
          paymentMethodId: input.payment.paymentMethodId,
          amount: input.payment.amount,
          concept: `Inscripción ${tournament.name} · ${team.name}`,
          cashSessionId: input.payment.cashSessionId ?? null,
          membershipId: input.membershipId,
          receivedById: input.createdById,
        });
        paid = input.payment.amount >= fee;

        await tx.tournamentTeam.update({
          where: { id: team.id },
          data: { paymentStatus: paid ? 'PAID' : 'PARTIAL' },
        });
      }

      return {
        id: team.id,
        name: team.name,
        entryFee: fee,
        paid,
        spotsLeft: tournament.maxTeams - tournament._count.teams - 1,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Fixture
  // -------------------------------------------------------------------------

  /**
   * Sortea el cuadro.
   *
   * Solo funciona si no hay partidos generados. Regenerar un fixture ya
   * publicado deja a los equipos con horarios viejos.
   */
  async generateFixture(
    tournamentId: string,
    clubId: string,
    options: { groupCount?: number; americanoRounds?: number } = {},
  ) {
    return this.prisma.tenantTransaction(async (tx) => {
      const tournament = await tx.tournament.findFirst({
        where: { id: tournamentId, deletedAt: null },
        select: {
          id: true, name: true, format: true, status: true,
          teams: { select: { id: true, name: true, seed: true } },
          _count: { select: { matches: true } },
        },
      });

      if (!tournament) throw new NotFoundException('Torneo no encontrado');
      if (tournament._count.matches > 0) {
        throw new ConflictException(
          'El fixture ya está generado. Si necesitás rehacerlo, borralo primero.',
        );
      }
      if (tournament.teams.length < 2) {
        throw new BadRequestException(
          'Hacen falta al menos dos equipos para sortear.',
        );
      }

      const seeds: SeedTeam[] = tournament.teams.map(
        (t: { id: string; name: string; seed: number | null }) => ({
          id: t.id, name: t.name, seed: t.seed ?? undefined,
        }),
      );

      const matches = this.buildMatches(
        tournament.format as Format, seeds, options,
      );

      if (matches.length === 0) {
        throw new BadRequestException(
          'No se pudo generar el fixture con esa configuración.',
        );
      }

      await tx.tournamentMatch.createMany({
        data: matches.map((m) => ({
          clubId,
          tournamentId,
          round: m.round,
          roundNumber: m.roundNumber,
          matchNumber: m.matchNumber,
          homeTeamId: m.homeTeamId,
          awayTeamId: m.awayTeamId,
          // Un bye no se juega: queda cerrado desde el sorteo.
          status: (m.isBye ? 'WALKOVER' : 'SCHEDULED') as never,
          winnerTeamId: m.isBye ? (m.homeTeamId ?? m.awayTeamId) : null,
        })),
      });

      // Asignar los grupos a los equipos, para poder mostrar la tabla.
      if (tournament.format === 'GROUPS_PLAYOFF') {
        const groupByTeam = new Map<string, string>();
        for (const m of matches) {
          if (!m.groupName) continue;
          if (m.homeTeamId) groupByTeam.set(m.homeTeamId, m.groupName);
          if (m.awayTeamId) groupByTeam.set(m.awayTeamId, m.groupName);
        }
        for (const [teamId, groupName] of groupByTeam) {
          await tx.tournamentTeam.update({
            where: { id: teamId },
            data: { groupName },
          });
        }
      }

      await tx.tournament.update({
        where: { id: tournamentId },
        data: { status: 'IN_PROGRESS' },
      });

      return {
        generated: matches.length,
        rounds: Math.max(...matches.map((m) => m.roundNumber)),
        byes: matches.filter((m) => m.isBye).length,
      };
    });
  }

  private buildMatches(
    format: Format,
    teams: SeedTeam[],
    options: { groupCount?: number; americanoRounds?: number },
  ): GeneratedMatch[] {
    switch (format) {
      case 'ELIMINATION':
      case 'DOUBLE_ELIMINATION':
        // La doble eliminación se genera como simple por ahora: el cuadro de
        // perdedores necesita su propia estructura y todavía no hay demanda.
        return generateElimination(teams);
      case 'ROUND_ROBIN':
        return generateRoundRobin(teams);
      case 'GROUPS_PLAYOFF':
        return generateGroups(teams, options.groupCount ?? 2);
      case 'AMERICANO':
        return generateAmericano(teams, options.americanoRounds ?? 5);
      default:
        return [];
    }
  }

  /** Borra el fixture. Solo si no se cargó ningún resultado. */
  async resetFixture(tournamentId: string) {
    return this.prisma.tenantTransaction(async (tx) => {
      const played = await tx.tournamentMatch.count({
        where: { tournamentId, status: { in: ['FINISHED', 'WALKOVER'] } },
      });

      // Los byes son walkover pero no son resultados cargados: se los
      // excluye contando solo los que tienen resultado real.
      const withScore = await tx.tournamentMatch.count({
        where: { tournamentId, scoreSets: { not: Prisma.DbNull } },
      });

      if (withScore > 0) {
        throw new ConflictException(
          `Ya hay ${withScore} resultado(s) cargado(s). No se puede rehacer el fixture.`,
        );
      }

      await tx.tournamentMatch.deleteMany({ where: { tournamentId } });
      await tx.tournamentTeam.updateMany({
        where: { tournamentId },
        data: { groupName: null, played: 0, won: 0, lost: 0, points: 0 },
      });
      await tx.tournament.update({
        where: { id: tournamentId },
        data: { status: 'REGISTRATION_CLOSED' },
      });

      return { deleted: played };
    });
  }

  // -------------------------------------------------------------------------
  // Resultados
  // -------------------------------------------------------------------------

  /**
   * Carga el resultado de un partido.
   *
   * Valida que el marcador sea posible en pádel: 6-5 o 9-3 no existen, y
   * cargarlos ensucia la tabla sin que nadie lo note hasta que las
   * posiciones no cierran.
   *
   * En eliminación, avanza al ganador a la ronda siguiente.
   */
  async recordResult(
    matchId: string,
    input: {
      clubId: string;
      scoreSets: Array<[number, number]>;
      walkoverWinnerId?: string;
      createdById?: string | null;
    },
  ) {
    return this.prisma.tenantTransaction(async (tx) => {
      const match = await tx.tournamentMatch.findFirst({
        where: { id: matchId },
        select: {
          id: true, tournamentId: true, roundNumber: true, matchNumber: true,
          homeTeamId: true, awayTeamId: true, status: true,
          tournament: { select: { format: true } },
        },
      });

      if (!match) throw new NotFoundException('Partido no encontrado');
      if (!match.homeTeamId || !match.awayTeamId) {
        throw new ConflictException(
          'El partido todavía no tiene los dos equipos definidos.',
        );
      }

      let winnerId: string;
      let scoreSets: Array<[number, number]> | null = null;

      if (input.walkoverWinnerId) {
        if (![match.homeTeamId, match.awayTeamId].includes(input.walkoverWinnerId)) {
          throw new BadRequestException('El ganador no juega este partido.');
        }
        winnerId = input.walkoverWinnerId;
      } else {
        const check = validateScore(input.scoreSets);
        if (!check.valid) {
          throw new BadRequestException(check.reason);
        }
        scoreSets = input.scoreSets;

        let home = 0, away = 0;
        for (const [h, a] of input.scoreSets) {
          if (h > a) home++; else away++;
        }
        winnerId = home > away ? match.homeTeamId : match.awayTeamId;
      }

      const loserId = winnerId === match.homeTeamId
        ? match.awayTeamId
        : match.homeTeamId;

      await tx.tournamentMatch.update({
        where: { id: matchId },
        data: {
          scoreSets: scoreSets as never,
          winnerTeamId: winnerId,
          status: (input.walkoverWinnerId ? 'WALKOVER' : 'FINISHED') as never,
        },
      });

      // Los contadores del equipo se actualizan acá para que el listado no
      // tenga que recalcular la tabla entera.
      await tx.tournamentTeam.update({
        where: { id: winnerId },
        data: { played: { increment: 1 }, won: { increment: 1 }, points: { increment: 3 } },
      });
      await tx.tournamentTeam.update({
        where: { id: loserId },
        data: { played: { increment: 1 }, lost: { increment: 1 } },
      });

      // En eliminación, el ganador pasa a la ronda siguiente.
      let advancedTo: string | null = null;
      if (['ELIMINATION', 'DOUBLE_ELIMINATION'].includes(match.tournament.format)) {
        advancedTo = await this.advanceWinner(tx, match, winnerId);
      }

      return { winnerId, advancedTo };
    });
  }

  /**
   * Ubica al ganador en el partido siguiente.
   *
   * El partido N de una ronda alimenta el partido ceil(N/2) de la siguiente;
   * si N es impar va como local, si es par como visitante. Es la aritmética
   * estándar de un cuadro.
   */
  private async advanceWinner(
    tx: Prisma.TransactionClient,
    match: { tournamentId: string; roundNumber: number; matchNumber: number },
    winnerId: string,
  ): Promise<string | null> {
    const nextRound = match.roundNumber + 1;
    const nextMatchNumber = Math.ceil(match.matchNumber / 2);
    const asHome = match.matchNumber % 2 === 1;

    const next = (await tx.tournamentMatch.findFirst({
      where: {
        tournamentId: match.tournamentId,
        roundNumber: nextRound,
        matchNumber: nextMatchNumber,
      },
      select: { id: true },
    })) as { id: string } | null;

    if (!next) return null;

    await tx.tournamentMatch.update({
      where: { id: next.id },
      data: asHome ? { homeTeamId: winnerId } : { awayTeamId: winnerId },
    });

    return next.id;
  }

  // -------------------------------------------------------------------------
  // Vistas
  // -------------------------------------------------------------------------

  async getFixture(tournamentId: string) {
    const matches = await this.prisma.db.tournamentMatch.findMany({
      where: { tournamentId },
      select: {
        id: true, round: true, roundNumber: true, matchNumber: true,
        scheduledAt: true, courtId: true, scoreSets: true,
        winnerTeamId: true, status: true,
        homeTeam: { select: { id: true, name: true, groupName: true } },
        awayTeam: { select: { id: true, name: true } },
      },
      orderBy: [{ roundNumber: 'asc' }, { matchNumber: 'asc' }],
    });

    // Se agrupa por ronda porque así se dibuja el cuadro.
    const byRound = new Map<string, typeof matches>();
    for (const m of matches) {
      const list = byRound.get(m.round) ?? [];
      list.push(m);
      byRound.set(m.round, list);
    }

    return [...byRound.entries()].map(([round, list]) => ({
      round,
      roundNumber: list[0]?.roundNumber ?? 0,
      matches: list,
    }));
  }

  async getStandings(tournamentId: string) {
    const [teams, matches] = await Promise.all([
      this.prisma.db.tournamentTeam.findMany({
        where: { tournamentId },
        select: { id: true, name: true, groupName: true },
      }),
      this.prisma.db.tournamentMatch.findMany({
        where: { tournamentId },
        select: {
          homeTeamId: true, awayTeamId: true, scoreSets: true,
          status: true, winnerTeamId: true,
        },
      }),
    ]);

    const results = matches.map((m: Record<string, unknown>) => ({
      homeTeamId: (m.homeTeamId as string) ?? null,
      awayTeamId: (m.awayTeamId as string) ?? null,
      scoreSets: (m.scoreSets as Array<[number, number]>) ?? null,
      status: String(m.status),
      winnerTeamId: (m.winnerTeamId as string) ?? null,
    }));

    // Con grupos, cada uno tiene su tabla: mezclarlas no dice nada.
    const groups = [...new Set(
      teams.map((t: { groupName: string | null }) => t.groupName).filter(Boolean),
    )] as string[];

    if (groups.length === 0) {
      return [{
        group: null,
        standings: calculateStandings(teams, results),
      }];
    }

    return groups.sort().map((group) => ({
      group,
      standings: calculateStandings(
        teams.filter((t: { groupName: string | null }) => t.groupName === group),
        results,
      ),
    }));
  }

  /** Cuántos partidos daría cada formato. Se consulta antes de sortear. */
  estimate(format: Format, teamCount: number, groupCount = 2) {
    return {
      format,
      teamCount,
      estimatedMatches: estimateMatches(format, teamCount, groupCount),
    };
  }

  private num(v: unknown): number {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'number') return v;
    return Number((v as { toString(): string }).toString());
  }
}
