import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../../auth/auth.service';
import { runWithoutTenancy } from '../../tenancy/tenant-context';
import { seedClubDefaultsTx } from './club-defaults.seeder';
import type { CreateClubDto } from '../dto/onboarding.dto';

interface DeviceInfo {
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Alta de clubes nuevos (self-service).
 *
 * Convierte un formulario en un club operativo: crea el tenant, su dueño, y
 * toda la configuración por defecto, de forma ATÓMICA. O queda todo, o no
 * queda nada: nunca un club a medio armar sin roles o sin dueño.
 */
@Injectable()
export class OnboardingService {
  private readonly log = new Logger(OnboardingService.name);

  // Slugs que no se pueden usar: chocarían con subdominios del sistema.
  private static readonly RESERVED_SLUGS = new Set([
    'www', 'app', 'api', 'admin', 'auth', 'login', 'signup', 'onboarding',
    'dashboard', 'mail', 'blog', 'help', 'support', 'status', 'docs',
    'static', 'cdn', 'assets', 'clubos', 'super', 'platform',
  ]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  /**
   * Disponibilidad de un slug (para el wizard, en vivo como un dominio).
   * No lo reserva: entre el chequeo y el submit podría tomarlo otro, y de eso
   * se encarga el unique constraint al crear.
   */
  async checkSlug(raw: string): Promise<{ slug: string; available: boolean; reason?: string }> {
    const slug = raw.trim().toLowerCase();

    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) {
      return { slug, available: false, reason: 'Formato inválido.' };
    }
    if (OnboardingService.RESERVED_SLUGS.has(slug)) {
      return { slug, available: false, reason: 'Ese nombre está reservado.' };
    }

    const existing = await this.prisma.club.findUnique({
      where: { slug },
      select: { id: true },
    });
    return existing
      ? { slug, available: false, reason: 'Ya está en uso.' }
      : { slug, available: true };
  }

  /**
   * Crea el club + dueño + defaults, y devuelve una sesión iniciada para el
   * dueño (queda logueado, sin un paso extra de login).
   */
  async createClub(dto: CreateClubDto, device: DeviceInfo) {
    const slug = dto.slug.trim().toLowerCase();

    // Validaciones baratas antes de abrir transacción.
    const slugCheck = await this.checkSlug(slug);
    if (!slugCheck.available) {
      throw new ConflictException(slugCheck.reason ?? 'Slug no disponible.');
    }

    const emailTaken = await this.prisma.user.findFirst({
      where: { email: dto.email.toLowerCase() },
      select: { id: true },
    });
    if (emailTaken) {
      throw new ConflictException('Ya existe una cuenta con ese email.');
    }

    // Plan: el elegido, o el starter por defecto.
    const plan = await this.prisma.plan.findFirst({
      where: { code: dto.planCode ?? 'starter', isActive: true },
      select: { id: true, code: true },
    });
    if (!plan) {
      throw new BadRequestException(
        'No hay un plan disponible para asignar. Contactá a soporte.',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const requestId = randomUUID();

    // El club aún no existe, así que no hay RLS que aplicar: se crea todo con
    // el contexto de plataforma (bypass), dentro de una única transacción.
    const created = await runWithoutTenancy(requestId, () =>
      this.prisma.$transaction(
        async (tx) => {
          // 1. Club (empieza en TRIAL, 14 días).
          const club = await tx.club.create({
            data: {
              slug,
              name: dto.clubName.trim(),
              taxId: dto.taxId ?? null,
              phone: dto.phone ?? null,
              addressCity: dto.city ?? null,
              status: 'TRIAL',
              trialEndsAt: new Date(Date.now() + 14 * 86_400_000),
              planId: plan.id,
            },
            select: { id: true, slug: true, name: true },
          });

          // 2. Config por defecto (roles, medios de pago, horarios, etc.).
          const defaults = await seedClubDefaultsTx(tx, club.id);

          // 3. Usuario dueño.
          const owner = await tx.user.create({
            data: {
              email: dto.email.toLowerCase(),
              passwordHash,
              firstName: dto.firstName.trim(),
              lastName: dto.lastName.trim(),
              phone: dto.phone ?? null,
              emailVerified: false,
            },
            select: { id: true },
          });

          // 4. Membresía: liga al dueño con el club, rol OWNER.
          await tx.membership.create({
            data: {
              clubId: club.id,
              userId: owner.id,
              roleId: defaults.ownerRoleId,
              status: 'ACTIVE',
              acceptedAt: new Date(),
            },
          });

          // 5. Primera cancha, para que la agenda no arranque vacía.
          await tx.court.create({
            data: {
              clubId: club.id,
              sportId: defaults.sportId,
              name: 'Cancha 1',
              number: 1,
              environment: 'INDOOR',
              surface: 'SYNTHETIC_GRASS',
              color: '#3B82F6',
              sortOrder: 1,
            },
          });

          return { club, ownerId: owner.id };
        },
        { timeout: 20_000 },
      ),
    );

    this.log.log(
      `Club creado: ${created.club.slug} (${created.club.id}), dueño ${created.ownerId}.`,
    );

    // Loguear al dueño reutilizando el camino de login probado.
    const session = await this.auth.login(
      { email: dto.email.toLowerCase(), password: dto.password },
      device,
    );

    return {
      club: {
        id: created.club.id,
        slug: created.club.slug,
        name: created.club.name,
      },
      session,
    };
  }
}
