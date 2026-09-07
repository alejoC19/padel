import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import {
  ChangePasswordDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  SwitchClubDto,
  type AuthResponse,
} from './dto/auth.dto';
import { Public, SkipTenant, UserId, Ctx } from '../common/decorators';
import type { TenantContext } from '../tenancy/tenant-context';

const REFRESH_COOKIE = 'refresh_token';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Rate limit agresivo: 5 intentos por minuto. El throttler global
   * (120/min) es demasiado permisivo para credenciales — permitiría
   * 7200 combinaciones por hora desde una IP.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Omit<AuthResponse, 'refreshToken'>> {
    const result = await this.auth.login(dto, this.device(req));
    return this.respond(res, result);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 300_000 } })
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Omit<AuthResponse, 'refreshToken'>> {
    const result = await this.auth.register(dto, this.device(req));
    return this.respond(res, result);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Omit<AuthResponse, 'refreshToken'>> {
    const token = this.readRefresh(req, dto.refreshToken);
    const result = await this.auth.refresh(token, this.device(req));
    return this.respond(res, result);
  }

  /** Cambio de club activo sin re-login. */
  @SkipTenant()
  @Post('switch-club')
  @HttpCode(HttpStatus.OK)
  async switchClub(
    @Body() dto: SwitchClubDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Omit<AuthResponse, 'refreshToken'>> {
    const token = this.readRefresh(req);
    const result = await this.auth.switchClub(
      token,
      dto.clubId,
      this.device(req),
    );
    return this.respond(res, result);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (token) await this.auth.logout(token);
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions(0));
  }

  /** Cierra la sesión en todos los dispositivos. */
  @SkipTenant()
  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutAll(
    @UserId() userId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logoutAll(userId);
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions(0));
  }

  @SkipTenant()
  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @UserId() userId: string,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.changePassword(userId, dto);
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions(0));
  }

  /** Contexto de la sesión actual. Lo usa el front al montar. */
  @Get('me')
  me(@Ctx() ctx: TenantContext) {
    return {
      userId: ctx.userId,
      clubId: ctx.clubId,
      roleCode: ctx.roleCode,
      permissions: [...ctx.permissions],
      isPlatformAdmin: ctx.isPlatformAdmin,
    };
  }

  // --- internos ---

  /**
   * El refresh token va en cookie httpOnly, no en el body de la respuesta.
   * Guardarlo en localStorage lo expone a cualquier XSS; en cookie httpOnly
   * el JS de la página no puede leerlo.
   *
   * El access token SÍ va en el body: es corto, y el front lo necesita para
   * el header Authorization.
   */
  private respond(
    res: Response,
    result: AuthResponse,
  ): Omit<AuthResponse, 'refreshToken'> {
    const { refreshToken, ...rest } = result;
    res.cookie(
      REFRESH_COOKIE,
      refreshToken,
      this.cookieOptions(Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30) * 86_400_000),
    );
    return rest;
  }

  private cookieOptions(maxAge: number) {
    return {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      // 'lax' permite que el usuario vuelva desde un link externo con la
      // sesión activa. 'strict' rompe ese flujo sin ganancia real acá,
      // porque el endpoint de refresh no es idempotente por diseño.
      sameSite: 'lax' as const,
      path: '/api/v1/auth',
      maxAge,
    };
  }

  private readRefresh(req: Request, fromBody?: string): string {
    const token = req.cookies?.[REFRESH_COOKIE] ?? fromBody;
    if (!token || typeof token !== 'string') {
      throw new UnauthorizedException('Refresh token requerido');
    }
    return token;
  }

  private device(req: Request) {
    const fwd = req.headers['x-forwarded-for'];
    return {
      userAgent: req.headers['user-agent'],
      ipAddress:
        typeof fwd === 'string'
          ? fwd.split(',')[0].trim()
          : req.socket?.remoteAddress,
    };
  }
}
