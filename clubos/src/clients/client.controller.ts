import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ClientService } from './services/client.service';
import { ClientSearchService } from './services/client-search.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateClientDto,
  CreateNoteDto,
  ListClientsDto,
  SearchClientsDto,
  StatementDto,
  UpdateClientDto,
} from './dto/client.dto';
import { ClubId, Ctx, RequirePermissions, UserId } from '../common/decorators';
import { PERMISSIONS } from '../common/permissions';
import type { TenantContext } from '../tenancy/tenant-context';

@Controller('clients')
export class ClientController {
  constructor(
    private readonly clients: ClientService,
    private readonly search: ClientSearchService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Búsqueda rápida. Es el endpoint más usado del sistema: recepción lo
   * llama en cada tecla mientras carga una reserva.
   */
  @Get('search')
  @RequirePermissions(PERMISSIONS.CLIENT_VIEW)
  async searchClients(
    @Query() q: SearchClientsDto,
    @ClubId() clubId: string,
  ) {
    return this.search.search(q.q, clubId, {
      limit: q.limit,
      includeInactive: q.includeInactive,
    });
  }

  @Get()
  @RequirePermissions(PERMISSIONS.CLIENT_VIEW)
  async list(@Query() q: ListClientsDto) {
    return this.clients.list(q);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CLIENT_CREATE)
  async create(
    @Body() dto: CreateClientDto,
    @ClubId() clubId: string,
    @UserId() userId: string,
  ) {
    const result = await this.clients.create(dto, clubId, userId);

    // Duplicados débiles (nombre parecido): no se crea nada todavía, se
    // devuelven los candidatos para que el operador decida. Reenviar con
    // force:true confirma el alta.
    if (result.duplicatesFound) {
      return {
        created: false,
        requiresConfirmation: true,
        message: 'Encontramos clientes parecidos. Revisá antes de continuar.',
        duplicates: result.duplicatesFound,
      };
    }

    return { created: true, id: result.id };
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CLIENT_VIEW)
  async profile(
    @Param('id', ParseUUIDPipe) id: string,
    @Ctx() ctx: TenantContext,
  ) {
    const profile = await this.clients.getProfile(id);

    // Los datos financieros requieren permiso propio: recepción gestiona
    // turnos, pero el gasto histórico y el LTV son información del negocio.
    if (!ctx.permissions.has(PERMISSIONS.CLIENT_VIEW_FINANCIALS)) {
      const { totalSpent, lifetimeValue, ...rest } = profile as Record<
        string,
        unknown
      >;
      return rest;
    }

    return profile;
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CLIENT_UPDATE)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClientDto,
    @ClubId() clubId: string,
    @UserId() userId: string,
    @Ctx() ctx: TenantContext,
  ) {
    // El límite de crédito define cuánta deuda tolera el club: no es un
    // dato administrativo más.
    if (
      dto.creditLimit !== undefined &&
      !ctx.permissions.has(PERMISSIONS.ACCOUNT_CREDIT_LIMIT)
    ) {
      throw new ForbiddenException(
        'No tenés permiso para modificar el límite de crédito.',
      );
    }

    if (
      dto.discountPercent !== undefined &&
      !ctx.permissions.has(PERMISSIONS.PRICE_MANAGE)
    ) {
      throw new ForbiddenException(
        'No tenés permiso para asignar descuentos.',
      );
    }

    return this.clients.update(id, dto, clubId, userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PERMISSIONS.CLIENT_DELETE)
  async archive(
    @Param('id', ParseUUIDPipe) id: string,
    @ClubId() clubId: string,
    @UserId() userId: string,
  ) {
    await this.clients.archive(id, clubId, userId);
  }

  @Get(':id/statement')
  @RequirePermissions(PERMISSIONS.ACCOUNT_VIEW)
  async statement(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: StatementDto,
  ) {
    return this.clients.getAccountStatement(id, q);
  }

  @Get(':id/notes')
  @RequirePermissions(PERMISSIONS.CLIENT_VIEW)
  async notes(
    @Param('id', ParseUUIDPipe) id: string,
    @Ctx() ctx: TenantContext,
  ) {
    const canSeeInternal = ctx.permissions.has(
      PERMISSIONS.CLIENT_NOTE_INTERNAL,
    );
    return this.prisma.db.clientNote.findMany({
      where: {
        clientId: id,
        deletedAt: null,
        ...(canSeeInternal ? {} : { isInternal: false }),
      },
      select: {
        id: true, content: true, category: true, priority: true,
        isInternal: true, createdAt: true, authorId: true,
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      take: 50,
    });
  }

  @Post(':id/notes')
  @RequirePermissions(PERMISSIONS.CLIENT_UPDATE)
  async addNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateNoteDto,
    @ClubId() clubId: string,
    @UserId() userId: string,
  ) {
    return this.prisma.db.clientNote.create({
      data: {
        clubId,
        clientId: id,
        authorId: userId,
        content: dto.content,
        category: (dto.category ?? 'GENERAL') as never,
        priority: (dto.priority ?? 'NORMAL') as never,
        isInternal: dto.isInternal ?? true,
      },
      select: { id: true, createdAt: true },
    });
  }

  /** Recalcula etiquetas automáticas. Lo llama también un cron nocturno. */
  @Post(':id/refresh-tags')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.CLIENT_UPDATE)
  async refreshTags(
    @Param('id', ParseUUIDPipe) id: string,
    @ClubId() clubId: string,
  ) {
    const codes = await this.clients.applyAutoTags(id, clubId);
    return { tags: codes };
  }
}
