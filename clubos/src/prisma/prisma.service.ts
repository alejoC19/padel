import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { getTenantContext } from '../tenancy/tenant-context';

/**
 * PrismaService con aislamiento multi-tenant forzado a nivel de conexión.
 *
 * ---------------------------------------------------------------------------
 * EL PROBLEMA
 * ---------------------------------------------------------------------------
 * `SET LOCAL app.current_club_id` solo vive dentro de una transacción. Prisma
 * usa un pool: dos queries consecutivas fuera de transacción pueden salir por
 * conexiones distintas. Si se hace SET LOCAL en una y el SELECT en otra, la
 * política RLS no ve el club y la query devuelve cero filas — o peor, si se
 * usara SET (sin LOCAL), el valor quedaría pegado en la conexión y la próxima
 * request de OTRO club heredaría el clubId anterior. Eso es una fuga de datos
 * entre tenants.
 *
 * ---------------------------------------------------------------------------
 * LA SOLUCIÓN
 * ---------------------------------------------------------------------------
 * Toda operación tenant-scoped se envuelve en una transacción explícita que
 * ejecuta SET LOCAL como primera sentencia. `$extends` intercepta cada query
 * y la redirige por ese camino. El resultado: es imposible emitir una query
 * de negocio sin el clubId seteado, aunque el desarrollador lo olvide.
 *
 * El costo es una transacción por operación. A cambio, la fuga entre clubes
 * pasa de "depende de que nadie se equivoque" a "imposible por construcción".
 * Para un SaaS multi-tenant es el trade-off correcto.
 *
 * ---------------------------------------------------------------------------
 * NOTA SOBRE `this` DENTRO DE $extends
 * ---------------------------------------------------------------------------
 * Dentro de `$allOperations`, `this` NO es el PrismaClient: es el contexto de
 * la extensión, que no tiene `$transaction`. Por eso se captura una referencia
 * al cliente base (`baseClient`) ANTES del extend y se usa esa referencia para
 * abrir la transacción. Usar `this.$transaction` ahí lanza
 * "this.$transaction is not a function".
 * ---------------------------------------------------------------------------
 */

/** Tablas de plataforma: no tienen club_id, no requieren contexto. */
const PLATFORM_MODELS = new Set<string>([
  'Plan',
  'Club',
  'User',
  'UserIdentity',
  'Session',
]);

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  readonly db: PrismaClient;

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
      transactionOptions: {
        maxWait: 5_000,
        timeout: 15_000,
      },
    });

    // Referencia al cliente base (este PrismaService), que SÍ tiene
    // $transaction. Se usa dentro del extend, donde `this` no sirve.
    const baseClient = this;

    /**
     * Cliente tenant-aware. Los servicios inyectan PrismaService y usan
     * `prisma.db.booking.findMany(...)`, no `prisma.booking.findMany(...)`.
     *
     * El clubId se lee de AsyncLocalStorage en el momento de ejecutar, no al
     * construir, así que un solo cliente extendido sirve para todas las
     * requests.
     */
    this.db = this.$extends({
      query: {
        $allModels: {
          async $allOperations({
            model,
            operation,
            args,
            query,
          }: {
            model?: string;
            operation: string;
            args: unknown;
            query: (args: unknown) => Promise<unknown>;
          }) {
            const ctx = getTenantContext();

            // Operaciones de plataforma o modelos sin club_id: paso directo.
            if (
              !model ||
              PLATFORM_MODELS.has(model) ||
              ctx?.bypassTenancy ||
              operation === '$queryRaw' ||
              operation === '$executeRaw'
            ) {
              return query(args);
            }

            if (!ctx?.clubId) {
              throw new Error(
                `Acceso a ${model}.${operation} sin club activo. ` +
                  'Falta TenantGuard o el endpoint debe ser de plataforma.',
              );
            }

            // El SET LOCAL y la query comparten transacción => misma conexión.
            // Se usa baseClient (no `this`) porque dentro del extend `this` no
            // es el PrismaClient y no tiene $transaction.
            return baseClient.$transaction(async (tx) => {
              await tx.$executeRaw`SELECT set_config('app.current_club_id', ${ctx.clubId}, true)`;
              return query(args);
            });
          },
        },
      },
    }) as unknown as PrismaClient;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();

    if (process.env.LOG_QUERIES === 'true') {
      this.$on('query' as never, (e: Prisma.QueryEvent) => {
        if (e.duration > 200) {
          this.logger.warn(`Slow query ${e.duration}ms: ${e.query}`);
        }
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Transacción explícita para casos de uso que escriben varias entidades
   * de forma atómica (cobrar una reserva = Payment + CashMovement +
   * AccountEntry + update de Booking).
   *
   * Setea el clubId UNA sola vez para toda la transacción, evitando la
   * transacción-por-query de `db`. Usar siempre que haya más de una
   * escritura relacionada.
   */
  async tenantTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<T> {
    const ctx = getTenantContext();

    if (!ctx?.clubId && !ctx?.bypassTenancy) {
      throw new Error('tenantTransaction requiere un club activo.');
    }

    return this.$transaction(
      async (tx) => {
        if (ctx?.clubId) {
          await tx.$executeRaw`SELECT set_config('app.current_club_id', ${ctx.clubId}, true)`;
        }
        return fn(tx);
      },
      {
        isolationLevel:
          options?.isolationLevel ?? Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: 15_000,
      },
    );
  }

  /**
   * Ejecuta una query cruda (SQL) CON el club activo seteado.
   *
   * Las raw queries no pasan por el interceptor de `db`, así que sin esto
   * `current_club_id()` viene vacío y la RLS bloquea o devuelve cero filas.
   * Este helper abre una transacción, setea el club, y corre la query dentro,
   * garantizando que `current_club_id()` funcione.
   *
   * Uso: this.prisma.tenantQueryRaw(sql, ...params)
   */
  async tenantQueryRaw<T = unknown>(
    sql: string,
    ...params: unknown[]
  ): Promise<T> {
    const ctx = getTenantContext();
    if (!ctx?.clubId && !ctx?.bypassTenancy) {
      throw new Error('tenantQueryRaw requiere un club activo.');
    }
    return this.$transaction(async (tx) => {
      if (ctx?.clubId) {
        await tx.$executeRaw`SELECT set_config('app.current_club_id', ${ctx.clubId}, true)`;
      }
      return tx.$queryRawUnsafe<T>(sql, ...params);
    });
  }

  /** Salud para el endpoint /health. */
  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
