import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { getTenantContext } from '../../tenancy/tenant-context';
import { reportError } from '../observability/error-reporter';

/**
 * Filtro catch-all: la última red de seguridad.
 *
 * El PrismaExceptionFilter maneja errores del motor; las HttpException las
 * maneja Nest. Todo lo DEMÁS (un bug, un throw inesperado) caería como 500
 * genérico sin traza. Este filtro lo captura, lo loguea con contexto completo
 * (requestId, clubId, ruta) y lo manda al error reporter (Sentry si está
 * configurado). Al cliente le devuelve un 500 limpio sin filtrar internals.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('UnhandledException');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request>();
    const ctx = getTenantContext();

    // Si ya es una HttpException, respetamos su status y mensaje.
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      // Solo reportamos 5xx; los 4xx son esperables (validación, permisos).
      if (status >= 500) {
        this.report(exception, req, ctx, status);
      }
      res.status(status).json(
        typeof body === 'string' ? { statusCode: status, message: body } : body,
      );
      return;
    }

    // Cualquier otra cosa: bug no manejado → 500.
    const status = HttpStatus.INTERNAL_SERVER_ERROR;
    this.report(exception, req, ctx, status);

    res.status(status).json({
      statusCode: status,
      code: 'INTERNAL_ERROR',
      // Nunca filtrar el mensaje real del error al cliente en producción.
      message: 'Ocurrió un error inesperado. Ya estamos al tanto.',
      requestId: ctx?.requestId,
    });
  }

  private report(
    exception: unknown,
    req: Request,
    ctx: ReturnType<typeof getTenantContext>,
    status: number,
  ): void {
    const err = exception instanceof Error ? exception : new Error(String(exception));

    this.logger.error(
      `${req.method} ${req.url} → ${status}: ${err.message}`,
      err.stack,
    );

    // Hook de error tracking (Sentry u otro). No-op si no está configurado.
    reportError(err, {
      method: req.method,
      url: req.url,
      status,
      requestId: ctx?.requestId,
      clubId: ctx?.clubId ?? undefined,
      userId: ctx?.userId ?? undefined,
    });
  }
}
