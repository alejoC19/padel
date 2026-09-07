import { ConsoleLogger, LogLevel } from '@nestjs/common';
import { getTenantContext } from '../../tenancy/tenant-context';

/**
 * Logger estructurado.
 *
 * En producción emite una línea JSON por evento: buscable y filtrable en
 * cualquier agregador (Grafana Loki, Datadog, CloudWatch, el panel de Railway/
 * Render). En desarrollo cae al formato lindo de Nest, más legible a ojo.
 *
 * Enriquece cada log con el requestId y el clubId del contexto actual, así se
 * puede seguir una request completa a través de todos sus logs — clave para
 * depurar en un multi-tenant ("¿qué pasó con el club X a las 14:03?").
 */
export class StructuredLogger extends ConsoleLogger {
  private readonly json = process.env.NODE_ENV === 'production';

  private write(level: LogLevel, message: unknown, context?: string) {
    if (!this.json) {
      // Delega al formato bonito de Nest en dev.
      super[level === 'log' ? 'log' : level](message as string, context ?? '');
      return;
    }

    const ctx = getTenantContext();
    const line = {
      level,
      time: new Date().toISOString(),
      context: context ?? this.context,
      message:
        typeof message === 'string' ? message : safeStringify(message),
      requestId: ctx?.requestId,
      clubId: ctx?.clubId ?? undefined,
      userId: ctx?.userId ?? undefined,
    };
    // Una línea JSON por evento.
    process.stdout.write(JSON.stringify(line) + '\n');
  }

  log(message: unknown, context?: string) {
    this.write('log', message, context);
  }
  error(message: unknown, stackOrContext?: string, context?: string) {
    if (!this.json) {
      super.error(message as string, stackOrContext as string, context as string);
      return;
    }
    const ctx = getTenantContext();
    process.stdout.write(
      JSON.stringify({
        level: 'error',
        time: new Date().toISOString(),
        context: context ?? this.context,
        message: typeof message === 'string' ? message : safeStringify(message),
        stack: stackOrContext,
        requestId: ctx?.requestId,
        clubId: ctx?.clubId ?? undefined,
      }) + '\n',
    );
  }
  warn(message: unknown, context?: string) {
    this.write('warn', message, context);
  }
  debug(message: unknown, context?: string) {
    this.write('debug', message, context);
  }
  verbose(message: unknown, context?: string) {
    this.write('verbose', message, context);
  }
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
