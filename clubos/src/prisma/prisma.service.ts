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
 *
 * ---------------------------------------------------------------------------
 * BYPASS DE PLATAFORMA (`runWithoutTenancy` / `ctx.bypassTenancy`)
 * ---------------------------------------------------------------------------
 * `DATABASE_URL` es el rol restringido `clubos_app`, sujeto a RLS con FORCE.
 * Eso es intencional para el 99% de las queries (todo lo que cuelga de una
 * request HTTP), pero un puñado de operaciones son legítimamente
 * multi-tenant por naturaleza y necesitan saltarse RLS de verdad:
 *   - alta de club (todavía no existe ningún clubId al que "pertenecer")
 *   - listar los clubes a los que pertenece un usuario (login)
 *   - jobs de plataforma (cola de notificaciones, recordatorios)
 * `bypassTenancy: true` NO alcanza para esto por sí solo: solo salta el
 * SET LOCAL, pero la conexión sigue siendo `clubos_app` y RLS igual
 * bloquea (deja 0 filas en SELECT, rechaza el INSERT). Por eso estas
 * operaciones corren en `platform`, una conexión aparte con el rol owner
 * (que si es superusuario de Postgres, bypassea RLS pase lo que pase,
 * incluso con FORCE — ver README "Conexión: usar el rol correcto").
 * Esta conexión NUNCA se expone directamente a un controller: solo se usa
 * acá adentro, y solo cuando `ctx.bypassTenancy` viene en true, que a su vez
 * solo lo setea `runWithoutTenancy` (nunca un guard HTTP normal).
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

function lowerFirst(s: string): string {
  return s.length ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  readonly db: PrismaClient;

  /**
   * Conexión elevada (rol owner) para operaciones de plataforma genuinamente
   * multi-tenant. Ver "BYPASS DE PLATAFORMA" arriba. Nunca se expone fuera
   * de esta clase.
   */
  private readonly platform: PrismaClient;

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

    this.platform = new PrismaClient({
      datasourceUrl:
        process.env.PLATFORM_DATABASE_URL ??
        process.env.DIRECT_URL ??
        process.env.DATABASE_URL,
    });

    // Referencia al cliente base (este PrismaService), que SÍ tiene
    // $transaction. Se usa dentro del extend, donde `this` no sirve.
    const baseClient = this;
    const platformClient = this.platform;

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

            // Modelos sin club_id o raw queries: paso directo (sin RLS).
            if (
              !model ||
              PLATFORM_MODELS.has(model) ||
              operation === '$queryRaw' ||
              operation === '$executeRaw'
            ) {
              return query(args);
            }

            // Bypass de plataforma explícito: modelo CON club_id (sujeto a
            // RLS) pero la operación es legítimamente multi-tenant (alta de
            // club, listar clubes de un usuario, jobs de cola). No alcanza
            // con saltear el SET LOCAL — la conexión de `clubos_app` igual
            // queda sujeta a RLS y bloquea todo. Se re-emite la misma
            // operación sobre `platform` (rol elevado) en vez de forwardear
            // `query(args)`, que sigue atado al cliente restringido.
            if (ctx?.bypassTenancy) {
              const delegate = (platformClient as unknown as Record<string, any>)[
                lowerFirst(model)
              ];
              return delegate[operation](args);
            }

            if (!ctx?.clubId) {
              throw new Error(
                `Acceso a ${model}.${operation} sin club activo. ` +
                  'Falta TenantGuard o el endpoint debe ser de plataforma.',
              );
            }

            // El SET LOCAL y la query comparten transacción => misma conexión.
            //
            // OJO: tiene que ser la forma ARRAY de $transaction, no la forma
            // interactiva `$transaction(async (tx) => {...})`. En la forma
            // interactiva, `query(args)` (el forward de la operación original
            // que da la extensión) NO corre sobre `tx` — sigue atado al
            // cliente base y Prisma puede abrirlo en OTRA conexión del pool.
            // Con RLS bypasseada (rol superusuario) esto no se nota porque
            // cualquier conexión ve todo; con el rol restringido de la app,
            // el SET LOCAL queda en una conexión y el INSERT/SELECT real en
            // otra, y la policy de RLS rechaza todo (o no ve ninguna fila).
            // La forma array SÍ garantiza que todos los statements corran en
            // la misma transacción/conexión — es el patrón documentado por
            // Prisma para este caso exacto (RLS vía extensión).
            const [, result] = await baseClient.$transaction([
              baseClient.$executeRaw`SELECT set_config('app.current_club_id', ${ctx.clubId}, true)`,
              query(args) as Prisma.PrismaPromise<unknown>,
            ]);
            return result;
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
    await this.platform.$disconnect();
  }

  /**
   * Acceso directo a la conexión elevada, para jobs de plataforma que
   * necesitan `$queryRaw`/`$transaction` NATIVOS cross-tenant (el worker de
   * notificaciones, que procesa filas de TODOS los clubes en un mismo
   * `UPDATE ... RETURNING`). Estos no pasan por `db` ni por
   * `tenantTransaction` porque no hay UN clubId al que atarse.
   *
   * Solo funciona con `bypassTenancy` activo (adentro de
   * `runWithoutTenancy`), para que sea imposible usarlo por accidente desde
   * el camino normal de una request HTTP.
   */
  get platformDb(): PrismaClient {
    const ctx = getTenantContext();
    if (!ctx?.bypassTenancy) {
      throw new Error(
        'platformDb requiere bypassTenancy=true (envolver en runWithoutTenancy).',
      );
    }
    return this.platform;
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
    options?: {
      isolationLevel?: Prisma.TransactionIsolationLevel;
      timeout?: number;
    },
  ): Promise<T> {
    const ctx = getTenantContext();

    if (!ctx?.clubId && !ctx?.bypassTenancy) {
      throw new Error('tenantTransaction requiere un club activo.');
    }

    // Bypass de plataforma (alta de club, etc.): correr en la conexión
    // elevada, no en la restringida — ver "BYPASS DE PLATAFORMA" arriba.
    const client = ctx?.bypassTenancy ? this.platform : this;

    return client.$transaction(
      async (tx) => {
        if (ctx?.clubId) {
          await tx.$executeRaw`SELECT set_config('app.current_club_id', ${ctx.clubId}, true)`;
        }
        return fn(tx);
      },
      {
        isolationLevel:
          options?.isolationLevel ?? Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: options?.timeout ?? 15_000,
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
    const client = ctx?.bypassTenancy ? this.platform : this;
    return client.$transaction(async (tx) => {
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
