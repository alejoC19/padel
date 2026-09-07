import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/**
 * Tipos de documento numerados.
 *
 * RECEIPT es un comprobante interno del club (el papelito que se le da al
 * cliente), no una factura fiscal. ClubOS no emite comprobantes con validez
 * ante ARCA: eso lo maneja el contador con su propio sistema.
 */
export type DocType = 'BOOKING' | 'PAYMENT' | 'SALE' | 'EXPENSE' | 'RECEIPT';

const PREFIX: Record<DocType, string> = {
  BOOKING: 'R',
  PAYMENT: 'PAG',
  SALE: 'V',
  EXPENSE: 'G',
  RECEIPT: 'C',
};

/**
 * Numeración de documentos.
 *
 * SIEMPRE se llama dentro de una transacción existente (recibe `tx`). El
 * número y el documento que lo usa deben confirmarse juntos: si el número
 * se emitiera fuera de la transacción y esta luego fallara, quedaría un
 * hueco en la serie.
 *
 * Un hueco no rompe nada técnicamente, pero cuando el contador pide "todos
 * los comprobantes de mayo" y faltan tres números en el medio, hay que
 * explicar por qué — y la única respuesta honesta es "se perdieron".
 *
 * La atomicidad la garantiza `next_document_number()` en Postgres
 * (INSERT ... ON CONFLICT DO UPDATE RETURNING), no la aplicación.
 */
@Injectable()
export class DocumentNumberService {
  async next(
    tx: Prisma.TransactionClient,
    clubId: string,
    docType: DocType,
    at: Date = new Date(),
  ): Promise<{ code: string; number: number }> {
    const period = String(at.getUTCFullYear());

    const rows = await tx.$queryRaw<Array<{ next_document_number: bigint }>>`
      SELECT next_document_number(${clubId}::uuid, ${docType}, ${period})
    `;

    const number = Number(rows[0].next_document_number);
    const code = `${PREFIX[docType]}-${period}-${String(number).padStart(5, '0')}`;

    return { code, number };
  }
}
