import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus,
  Param, ParseUUIDPipe, Post, Query,
} from '@nestjs/common';
import { TournamentService } from './services/tournament.service';
import {
  CreateTournamentDto, GenerateFixtureDto, RecordResultDto, RegisterTeamDto,
} from './dto/tournament.dto';
import { ClubId, Ctx, RequirePermissions, UserId } from '../common/decorators';
import { PERMISSIONS } from '../common/permissions';
import type { TenantContext } from '../tenancy/tenant-context';
import type { Format } from './services/bracket';

@Controller('tournaments')
export class TournamentsController {
  constructor(private readonly tournaments: TournamentService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.TOURNAMENT_VIEW)
  async list(@Query('status') status?: string) {
    return this.tournaments.list(status);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.TOURNAMENT_MANAGE)
  async create(@Body() dto: CreateTournamentDto, @ClubId() clubId: string) {
    return this.tournaments.create({ clubId, ...dto, format: dto.format as Format });
  }

  /** Cuántos partidos daría cada formato. Se consulta antes de sortear. */
  @Get('estimate')
  @RequirePermissions(PERMISSIONS.TOURNAMENT_VIEW)
  async estimate(
    @Query('format') format: string,
    @Query('teams') teams: string,
    @Query('groups') groups?: string,
  ) {
    return this.tournaments.estimate(
      format as Format, Number(teams), groups ? Number(groups) : 2,
    );
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.TOURNAMENT_VIEW)
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.tournaments.getDetail(id);
  }

  @Get(':id/fixture')
  @RequirePermissions(PERMISSIONS.TOURNAMENT_VIEW)
  async fixture(@Param('id', ParseUUIDPipe) id: string) {
    return this.tournaments.getFixture(id);
  }

  @Get(':id/standings')
  @RequirePermissions(PERMISSIONS.TOURNAMENT_VIEW)
  async standings(@Param('id', ParseUUIDPipe) id: string) {
    return this.tournaments.getStandings(id);
  }

  /** Inscribe un equipo y cobra la inscripción. */
  @Post(':id/teams')
  @RequirePermissions(PERMISSIONS.TOURNAMENT_MANAGE)
  async registerTeam(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegisterTeamDto,
    @ClubId() clubId: string,
    @UserId() userId: string,
    @Ctx() ctx: TenantContext,
  ) {
    return this.tournaments.registerTeam(id, {
      clubId, ...dto,
      createdById: userId,
      membershipId: ctx.membershipId,
    });
  }

  /** Sortea el cuadro. Una sola vez. */
  @Post(':id/fixture')
  @RequirePermissions(PERMISSIONS.TOURNAMENT_MANAGE)
  async generateFixture(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GenerateFixtureDto,
    @ClubId() clubId: string,
  ) {
    return this.tournaments.generateFixture(id, clubId, dto);
  }

  /** Borra el fixture. Solo si no hay resultados cargados. */
  @Delete(':id/fixture')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.TOURNAMENT_MANAGE)
  async resetFixture(@Param('id', ParseUUIDPipe) id: string) {
    return this.tournaments.resetFixture(id);
  }

  @Post('matches/:matchId/result')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.TOURNAMENT_MANAGE)
  async recordResult(
    @Param('matchId', ParseUUIDPipe) matchId: string,
    @Body() dto: RecordResultDto,
    @ClubId() clubId: string,
    @UserId() userId: string,
  ) {
    return this.tournaments.recordResult(matchId, {
      clubId,
      scoreSets: dto.scoreSets ?? [],
      walkoverWinnerId: dto.walkoverWinnerId,
      createdById: userId,
    });
  }
}
