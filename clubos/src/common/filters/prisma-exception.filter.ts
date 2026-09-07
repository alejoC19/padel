import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { getTenantContext } from '../../tenancy/tenant-context';

/**
 * Traduce errores del motor a respuestas de dominio.
 *
 * Importa especialmente por los EXCLUDE constraints: la doble reserva ahora
 * la rechaza Postgres, no la aplicación. Sin este filtro, el usuario recibe
 * un 500 genérico donde debería leer "el horario ya está ocupado".
 */
@Catch(Prisma.PrismaClientKnownRequestError, Prisma.PrismaClientUnknownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(
    exception:
      | Prisma.PrismaClientKnownRequestError
      | Prisma.PrismaClientUnknownRequestError,
    host: ArgumentsHost,
  ): void {
    const res = host.switchToHttp().getResponse<Response>();
    const ctx = getTenantContext();

    const { status, code, message, details } = this.translate(exception);

    if (status >= 500) {
      this.logger.error(
        `[${ctx?.requestId}] club=${ctx?.clubId} ${exception.message}`,
      );
    }

    res.status(status).json({
      statusCode: status,
      error: code,
      message,
      ...(details ? { details } : {}),
      requestId: ctx?.requestId,
      timestamp: new Date().toISOString(),
    });
  }

  private translate(exception: any): {
    status: number;
    code: string;
    message: string;
    details?: unknown;
  } {
    const raw: string = exception.message ?? '';

    // --- EXCLUDE constraints (no los mapea Prisma: llegan como raw) ---
    if (raw.includes('bookings_no_overlap')) {
      return {
        status: HttpStatus.CONFLICT,
        code: 'BOOKING_OVERLAP',
        message:
          'Ese horario ya está ocupado en esta cancha. Actualizá la agenda y elegí otro.',
      };
    }

    if (raw.includes('court_blocks_no_overlap')) {
      return {
        status: HttpStatus.CONFLICT,
        code: 'BLOCK_OVERLAP',
        message: 'Ya existe un bloqueo que se superpone con ese período.',
      };
    }

    if (raw.includes('cash_sessions_one_open_per_register')) {
      return {
        status: HttpStatus.CONFLICT,
        code: 'CASH_SESSION_ALREADY_OPEN',
        message:
          'Ya hay una caja abierta en este puesto. Cerrala antes de abrir otra.',
      };
    }

    if (raw.includes('cash_sessions_difference_justified')) {
      return {
        status: HttpStatus.BAD_REQUEST,
        code: 'CASH_DIFFERENCE_UNJUSTIFIED',
        message:
          'No se puede cerrar la caja con diferencia sin indicar el motivo.',
      };
    }

    if (raw.includes('append-only')) {
      return {
        status: HttpStatus.FORBIDDEN,
        code: 'IMMUTABLE_RECORD',
        message:
          'Este registro no puede modificarse ni eliminarse. Registrá un ajuste o contra-asiento.',
      };
    }

    if (raw.includes('bookings_time_order')) {
      return {
        status: HttpStatus.BAD_REQUEST,
        code: 'INVALID_TIME_RANGE',
        message: 'La hora de fin debe ser posterior a la de inicio.',
      };
    }

    // --- RLS: la política rechazó la fila ---
    if (
      raw.includes('row-level security') ||
      raw.includes('violates row-level security policy')
    ) {
      return {
        status: HttpStatus.FORBIDDEN,
        code: 'TENANT_VIOLATION',
        message: 'Operación no permitida sobre datos de otro club.',
      };
    }

    // --- Códigos conocidos de Prisma ---
    switch (exception.code) {
      case 'P2002': {
        const target = (exception.meta?.target as string[]) ?? [];
        return {
          status: HttpStatus.CONFLICT,
          code: 'DUPLICATE',
          message: this.duplicateMessage(target),
          details: { fields: target },
        };
      }
      case 'P2003':
        return {
          status: HttpStatus.BAD_REQUEST,
          code: 'FK_VIOLATION',
          message: 'El registro referenciado no existe o fue eliminado.',
        };
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          code: 'NOT_FOUND',
          message: 'El registro no existe o no pertenece a este club.',
        };
      case 'P2034':
        return {
          status: HttpStatus.CONFLICT,
          code: 'WRITE_CONFLICT',
          message: 'Conflicto de concurrencia. Reintentá la operación.',
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          code: 'DATABASE_ERROR',
          message: 'Error al procesar la operación.',
        };
    }
  }

  private duplicateMessage(target: string[]): string {
    const t = target.join(',');
    if (t.includes('document_number'))
      return 'Ya existe un cliente con ese documento en el club.';
    if (t.includes('email')) return 'Ese email ya está registrado.';
    if (t.includes('barcode')) return 'Ya existe un producto con ese código de barras.';
    if (t.includes('sku')) return 'Ya existe un producto con ese SKU.';
    if (t.includes('number') && t.includes('court'))
      return 'Ya existe una cancha con ese número.';
    if (t.includes('fingerprint'))
      return 'Ese movimiento bancario ya fue importado.';
    return 'Ya existe un registro con esos datos.';
  }
}
