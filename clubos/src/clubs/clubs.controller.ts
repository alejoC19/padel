import { Body, Controller, Get, Patch } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateClubDto } from './dto/club.dto';
import { ClubId, RequirePermissions } from '../common/decorators';
import { PERMISSIONS } from '../common/permissions';

/**
 * Datos del club en sí (nombre, logo) — hasta ahora solo se podían cargar
 * en el onboarding inicial. Sin esta pantalla, cambiar el logo o corregir
 * el nombre después de crear el club requería tocar la base a mano.
 */
@Controller('clubs')
export class ClubsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  @RequirePermissions(PERMISSIONS.CLUB_SETTINGS)
  async me(@ClubId() clubId: string) {
    return this.prisma.db.club.findUniqueOrThrow({
      where: { id: clubId },
      select: { id: true, name: true, slug: true, logoUrl: true, coverUrl: true },
    });
  }

  @Patch('me')
  @RequirePermissions(PERMISSIONS.CLUB_SETTINGS)
  async update(@ClubId() clubId: string, @Body() dto: UpdateClubDto) {
    return this.prisma.db.club.update({
      where: { id: clubId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.logoUrl !== undefined ? { logoUrl: dto.logoUrl } : {}),
        ...(dto.coverUrl !== undefined ? { coverUrl: dto.coverUrl } : {}),
      },
      select: { id: true, name: true, slug: true, logoUrl: true, coverUrl: true },
    });
  }
}
