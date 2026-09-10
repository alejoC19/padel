import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';

import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { BookingsModule } from './bookings/bookings.module';
import { CourtsModule } from './courts/courts.module';
import { CashModule } from './cash/cash.module';
import { ClientsModule } from './clients/clients.module';
import { PosModule } from './pos/pos.module';
import { ReportsModule } from './reports/reports.module';
import { TreasuryModule } from './treasury/treasury.module';
import { TournamentsModule } from './tournaments/tournaments.module';
import { PaymentsGatewayModule } from './payments-gateway/payments-gateway.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { TeamModule } from './team/team.module';
import { AuditModule } from './audit/audit.module';
import { NotificationsModule } from './notifications/notifications.module';
import { HealthModule } from './health/health.module';
import { PublicModule } from './public/public.module';
import { BillingModule } from './billing/billing.module';
import { ClubsModule } from './clubs/clubs.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { TenantGuard } from './common/guards/tenant.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { TenantContextInterceptor } from './common/interceptors/tenant-context.interceptor';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

/**
 * ORDEN DE GUARDS — no reordenar.
 *
 *   1. Throttler        → corta abuso antes de tocar la BD
 *   2. JwtAuthGuard      → valida el token (sin BD)
 *   3. TenantGuard       → resuelve club + permisos (1 query), los deja en
 *                          req.tenantContext (todavía NO hay AsyncLocalStorage acá)
 *   4. PermissionsGuard  → verifica el set ya resuelto, leyendo req.tenantContext
 *
 * Nest los ejecuta en el orden de registro. Invertir 3 y 4 rompe todo:
 * PermissionsGuard leería un contexto que aún no existe.
 *
 * Los guards terminan de correr ANTES de que arranque la fase de
 * interceptores — TenantContextInterceptor es quien recién ahí abre el
 * AsyncLocalStorage (tenantStorage.run) para el resto del pipeline
 * (controller + todo lo que este `await`ea). Por eso los guards leen el
 * contexto de `req.tenantContext` en vez de por ALS.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1_000, limit: 10 },
      { name: 'medium', ttl: 60_000, limit: 120 },
    ]),
    JwtModule.register({ global: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    BookingsModule,
    CourtsModule,
    CashModule,
    ClientsModule,
    PosModule,
    ReportsModule,
    TreasuryModule,
    TournamentsModule,
    PaymentsGatewayModule,
    OnboardingModule,
    TeamModule,
    AuditModule,
    NotificationsModule,
    HealthModule,
    PublicModule,
    BillingModule,
    ClubsModule,

    // Módulos de dominio se agregan acá:
    // BookingsModule, ClientsModule, CashModule, AgendaModule, ...
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
    // Orden de filtros: el catch-all va primero (red de seguridad global);
    // el de Prisma es más específico (@Catch(Prisma...)) y gana para sus
    // errores. Nest da precedencia al match más específico.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
  ],
})
export class AppModule {}
