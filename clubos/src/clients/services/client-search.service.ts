import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface SearchResult {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  documentNumber: string | null;
  status: string;
  accountBalance: number;
  lastVisitAt: Date | null;
  avatarUrl: string | null;
  /** 0..1 — cuán parecido al término buscado. */
  score: number;
}

/**
 * Búsqueda de clientes.
 *
 * ---------------------------------------------------------------------------
 * CÓMO BUSCA RECEPCIÓN
 * ---------------------------------------------------------------------------
 * Con el cliente al teléfono. Escribe tres o cuatro letras del apellido, o
 * los últimos dígitos del celular, y necesita el resultado al instante. No
 * escribe el nombre completo ni con acentos correctos.
 *
 * Estrategia en dos niveles:
 *
 *   1. PREFIJO / SUBCADENA — `search_text LIKE '%term%'`. Cubre el 95% de
 *      los casos y usa el índice GIN trigram. Es lo que resuelve "gonz",
 *      "1145", "30111222".
 *
 *   2. SIMILITUD — si el prefijo no devuelve nada, se cae a `%>` (trigram
 *      similarity). Rescata errores de tipeo: "gonzales" encuentra
 *      "González". Es más caro, por eso solo corre cuando hace falta.
 *
 * El orden de resultados prioriza: coincidencia al inicio del apellido >
 * coincidencia en cualquier lado > similitud. Un apellido que empieza con
 * lo tipeado es casi siempre lo que se busca.
 * ---------------------------------------------------------------------------
 */
@Injectable()
export class ClientSearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(
    term: string,
    clubId: string,
    opts: { limit?: number; includeInactive?: boolean } = {},
  ): Promise<SearchResult[]> {
    const limit = Math.min(opts.limit ?? 20, 50);
    const normalized = this.normalize(term);

    if (normalized.length < 2) return [];

    const statusFilter = opts.includeInactive
      ? ''
      : `AND c.status <> 'BLACKLISTED'`;

    // Búsqueda por subcadena. `position()` da el ranking: cuanto más cerca
    // del inicio aparece el término, más relevante es el resultado.
    const rows = await this.prisma.db.$queryRawUnsafe<
      Array<Record<string, unknown>>
    >(
      `
      SELECT
        c.id, c."firstName", c."lastName", c.phone, c.email,
        c."documentNumber", c.status, c."accountBalance", c."lastVisitAt",
        c."avatarUrl",
        CASE
          WHEN lower(immutable_unaccent(c."lastName")) LIKE $2 || '%' THEN 1.0
          WHEN c.search_text LIKE $2 || '%' THEN 0.9
          ELSE 0.7
        END AS score
      FROM clients c
      WHERE c."clubId" = $1::uuid
        AND c."deletedAt" IS NULL
        ${statusFilter}
        AND c.search_text LIKE '%' || $2 || '%'
      ORDER BY score DESC, c."lastVisitAt" DESC NULLS LAST, c."lastName"
      LIMIT $3
      `,
      clubId,
      normalized,
      limit,
    );

    if (rows.length > 0) return rows.map((r: Record<string, unknown>) => this.toResult(r));

    // Nada por subcadena: probar con similitud (tolerancia a tipeo).
    const fuzzy = await this.prisma.db.$queryRawUnsafe<
      Array<Record<string, unknown>>
    >(
      `
      SELECT
        c.id, c."firstName", c."lastName", c.phone, c.email,
        c."documentNumber", c.status, c."accountBalance", c."lastVisitAt",
        c."avatarUrl",
        similarity(c.search_text, $2) AS score
      FROM clients c
      WHERE c."clubId" = $1::uuid
        AND c."deletedAt" IS NULL
        ${statusFilter}
        AND c.search_text %> $2
      ORDER BY score DESC, c."lastName"
      LIMIT $3
      `,
      clubId,
      normalized,
      limit,
    );

    return fuzzy.map((r: Record<string, unknown>) => this.toResult(r));
  }

  /**
   * Detecta posibles duplicados antes de dar de alta.
   *
   * El alta duplicada es el problema crónico de todo CRM de mostrador: el
   * mismo cliente cargado tres veces con variantes del nombre, y el
   * historial partido en tres. Chequear en el momento del alta es mucho
   * más barato que fusionar después.
   */
  async findPotentialDuplicates(
    data: {
      firstName: string;
      lastName: string;
      phone?: string;
      email?: string;
      documentNumber?: string;
    },
    clubId: string,
  ): Promise<Array<SearchResult & { matchedOn: string }>> {
    const out: Array<SearchResult & { matchedOn: string }> = [];
    const seen = new Set<string>();

    // Documento y email son identificadores fuertes: coincidencia exacta
    // es casi con certeza la misma persona.
    if (data.documentNumber) {
      const byDoc = await this.exactMatch(
        clubId,
        '"documentNumber"',
        data.documentNumber,
      );
      for (const r of byDoc) {
        if (!seen.has(r.id)) {
          seen.add(r.id);
          out.push({ ...r, matchedOn: 'documento' });
        }
      }
    }

    if (data.email) {
      const byEmail = await this.exactMatch(
        clubId,
        'email',
        data.email.toLowerCase(),
      );
      for (const r of byEmail) {
        if (!seen.has(r.id)) {
          seen.add(r.id);
          out.push({ ...r, matchedOn: 'email' });
        }
      }
    }

    // Teléfono: se comparan solo los últimos 8 dígitos, porque el mismo
    // número se carga como 1145678900, +541145678900 o 11-4567-8900.
    if (data.phone) {
      const digits = data.phone.replace(/\D/g, '').slice(-8);
      if (digits.length >= 8) {
        const byPhone = await this.prisma.db.$queryRawUnsafe<
          Array<Record<string, unknown>>
        >(
          `
          SELECT c.id, c."firstName", c."lastName", c.phone, c.email,
                 c."documentNumber", c.status, c."accountBalance",
                 c."lastVisitAt", c."avatarUrl", 1.0 AS score
          FROM clients c
          WHERE c."clubId" = $1::uuid AND c."deletedAt" IS NULL
            AND right(regexp_replace(coalesce(c.phone,''), '\\D', '', 'g'), 8) = $2
          LIMIT 5
          `,
          clubId,
          digits,
        );
        for (const raw of byPhone) {
          const r = this.toResult(raw);
          if (!seen.has(r.id)) {
            seen.add(r.id);
            out.push({ ...r, matchedOn: 'teléfono' });
          }
        }
      }
    }

    // Nombre completo muy parecido: señal débil, se informa pero no bloquea.
    const nameTerm = this.normalize(`${data.firstName} ${data.lastName}`);
    if (nameTerm.length >= 4) {
      const byName = await this.prisma.db.$queryRawUnsafe<
        Array<Record<string, unknown>>
      >(
        `
        SELECT c.id, c."firstName", c."lastName", c.phone, c.email,
               c."documentNumber", c.status, c."accountBalance",
               c."lastVisitAt", c."avatarUrl",
               similarity(lower(immutable_unaccent(c."firstName" || ' ' || c."lastName")), $2) AS score
        FROM clients c
        WHERE c."clubId" = $1::uuid AND c."deletedAt" IS NULL
          AND similarity(lower(immutable_unaccent(c."firstName" || ' ' || c."lastName")), $2) > 0.6
        ORDER BY score DESC
        LIMIT 5
        `,
        clubId,
        nameTerm,
      );
      for (const raw of byName) {
        const r = this.toResult(raw);
        if (!seen.has(r.id)) {
          seen.add(r.id);
          out.push({ ...r, matchedOn: 'nombre similar' });
        }
      }
    }

    return out;
  }

  // --- internos ---

  private async exactMatch(
    clubId: string,
    column: '"documentNumber"' | 'email',
    value: string,
  ): Promise<SearchResult[]> {
    const rows = await this.prisma.db.$queryRawUnsafe<
      Array<Record<string, unknown>>
    >(
      `
      SELECT c.id, c."firstName", c."lastName", c.phone, c.email,
             c."documentNumber", c.status, c."accountBalance",
             c."lastVisitAt", c."avatarUrl", 1.0 AS score
      FROM clients c
      WHERE c."clubId" = $1::uuid AND c."deletedAt" IS NULL
        AND lower(c.${column}) = lower($2)
      LIMIT 5
      `,
      clubId,
      value,
    );
    return rows.map((r: Record<string, unknown>) => this.toResult(r));
  }

  /**
   * Normaliza igual que la columna generada `search_text`: minúsculas y sin
   * acentos. Debe coincidir exactamente, o el LIKE no matchea nunca.
   */
  private normalize(s: string): string {
    return s
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      // Escapar comodines de LIKE para que no se interpreten.
      .replace(/[%_]/g, '\\$&');
  }

  private toResult(r: Record<string, unknown>): SearchResult {
    return {
      id: String(r.id),
      firstName: String(r.firstName),
      lastName: String(r.lastName),
      phone: (r.phone as string) ?? null,
      email: (r.email as string) ?? null,
      documentNumber: (r.documentNumber as string) ?? null,
      status: String(r.status),
      accountBalance: Number(r.accountBalance ?? 0),
      lastVisitAt: (r.lastVisitAt as Date) ?? null,
      avatarUrl: (r.avatarUrl as string) ?? null,
      score: Number(r.score ?? 0),
    };
  }
}
