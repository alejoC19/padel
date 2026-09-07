-- ============================================================================
-- ClubOS — Integridad a nivel motor + aislamiento multi-tenant
--
-- Ejecutar DESPUÉS de `prisma migrate deploy`.
-- Esto es lo que Prisma NO puede expresar y sin lo cual el sistema es inseguro.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ----------------------------------------------------------------------------
-- 1. DOBLE RESERVA: IMPOSIBLE
--
-- Este es el bug que tenía PadelPRO. Validar en la aplicación pierde siempre
-- ante concurrencia: dos requests simultáneos leen "libre" y ambos insertan.
-- El motor es el único árbitro válido.
-- ----------------------------------------------------------------------------

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS period tstzrange
  GENERATED ALWAYS AS (tstzrange("startsAt", "endsAt", '[)')) STORED;

-- Estados que NO ocupan la cancha (liberan el turno).
ALTER TABLE bookings
  ADD CONSTRAINT bookings_no_overlap
  EXCLUDE USING gist (
    "courtId" WITH =,
    period   WITH &&
  )
  WHERE (
    "deletedAt" IS NULL
    AND status NOT IN (
      'CANCELLED_BY_CLIENT',
      'CANCELLED_BY_CLUB',
      'NO_SHOW',
      'RESCHEDULED'
    )
  );

-- Coherencia temporal básica.
ALTER TABLE bookings
  ADD CONSTRAINT bookings_time_order CHECK ("endsAt" > "startsAt");

ALTER TABLE bookings
  ADD CONSTRAINT bookings_duration_matches
  CHECK ("durationMinutes" = EXTRACT(EPOCH FROM ("endsAt" - "startsAt")) / 60);

-- Un bloqueo de cancha tampoco puede solaparse consigo mismo.
ALTER TABLE court_blocks
  ADD COLUMN IF NOT EXISTS period tstzrange
  GENERATED ALWAYS AS (tstzrange("startsAt", "endsAt", '[)')) STORED;

ALTER TABLE court_blocks
  ADD CONSTRAINT court_blocks_no_overlap
  EXCLUDE USING gist (
    "courtId" WITH =,
    period   WITH &&
  )
  WHERE ("deletedAt" IS NULL AND "courtId" IS NOT NULL);

-- ----------------------------------------------------------------------------
-- 2. UNA SOLA CAJA ABIERTA POR PUESTO
-- Sin esto, dos recepcionistas abren turno simultáneo y el arqueo es basura.
-- ----------------------------------------------------------------------------

CREATE UNIQUE INDEX cash_sessions_one_open_per_register
  ON cash_sessions ("registerId")
  WHERE status = 'OPEN';

-- No se puede cerrar con diferencia sin justificar.
ALTER TABLE cash_sessions
  ADD CONSTRAINT cash_sessions_difference_justified
  CHECK (
    status <> 'CLOSED'
    OR difference IS NULL
    OR difference = 0
    OR ("differenceReason" IS NOT NULL AND length(trim("differenceReason")) > 0)
  );

-- ----------------------------------------------------------------------------
-- 3. LIBROS APPEND-ONLY
-- Caja, cuenta corriente y auditoría no se editan ni se borran. Nunca.
-- Un error se corrige con contra-asiento. Esto lo garantiza el motor,
-- no la buena voluntad del código.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Tabla append-only: % no admite % (id=%)',
    TG_TABLE_NAME, TG_OP, COALESCE(OLD.id::text, 'n/a');
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cash_movements_append_only
  BEFORE UPDATE OR DELETE ON cash_movements
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER account_entries_append_only
  BEFORE UPDATE OR DELETE ON account_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER stock_movements_append_only
  BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Montos de caja siempre positivos: el signo lo da `direction`.
ALTER TABLE cash_movements
  ADD CONSTRAINT cash_movements_positive CHECK (amount > 0);

-- ----------------------------------------------------------------------------
-- 4. AISLAMIENTO MULTI-TENANT (Row Level Security)
--
-- Este es el riesgo #1 del producto. `clubId` en cada tabla no alcanza:
-- un WHERE olvidado en un solo endpoint filtra datos entre clubes.
-- RLS hace que la fuga sea imposible incluso con código con bugs.
--
-- El backend abre cada transacción con:
--   SET LOCAL app.current_club_id = '<uuid>';
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION current_club_id() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.current_club_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'clubId'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING ("clubId" = current_club_id())
        WITH CHECK ("clubId" = current_club_id())
    $f$, t);
  END LOOP;
END $$;

-- Rol de aplicación: sujeto a RLS. El backend usa ESTE, nunca el owner.
-- (El owner del schema bypassea RLS salvo FORCE, por eso está forzado arriba.)
--   CREATE ROLE clubos_app LOGIN PASSWORD '...';
--   GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO clubos_app;

-- ----------------------------------------------------------------------------
-- 5. ÍNDICES QUE PRISMA NO GENERA
-- ----------------------------------------------------------------------------

-- Búsqueda de clientes por nombre con tolerancia a tipeo (recepción, en vivo).
CREATE INDEX clients_name_trgm
  ON clients USING gin (("firstName" || ' ' || "lastName") gin_trgm_ops);

-- Agenda del día: la query más caliente del sistema.
CREATE INDEX bookings_agenda_active
  ON bookings ("clubId", "startsAt")
  INCLUDE ("courtId", status, "clientId")
  WHERE "deletedAt" IS NULL;

-- Deudores: clientes con saldo negativo.
CREATE INDEX clients_debtors
  ON clients ("clubId", "accountBalance")
  WHERE "accountBalance" < 0 AND "deletedAt" IS NULL;

-- Cobros pendientes de acreditación (flujo de fondos proyectado).
CREATE INDEX payments_pending_settlement
  ON payments ("clubId", "settlementDate")
  WHERE "settledAt" IS NULL AND status = 'COMPLETED';

-- ----------------------------------------------------------------------------
-- 6. UNIQUES CON COLUMNAS NULLABLE
--
-- En Postgres NULL <> NULL dentro de un UNIQUE, así que los @@unique de
-- Prisma que incluyen columnas opcionales NO impiden duplicados. Ejemplos
-- reales en este schema: dos clientes sin DNI, dos productos sin SKU, dos
-- horarios de club sin cancha. Se cubren con índices parciales.
-- ----------------------------------------------------------------------------

-- Un solo horario por club/día cuando aplica a TODAS las canchas.
CREATE UNIQUE INDEX operating_hours_club_default_uq
  ON operating_hours ("clubId", "dayOfWeek", "openMinute")
  WHERE "courtId" IS NULL;

-- Email de cliente único solo si está cargado.
CREATE UNIQUE INDEX clients_email_uq
  ON clients ("clubId", email)
  WHERE email IS NOT NULL AND "deletedAt" IS NULL;

-- Documento único solo si está cargado.
CREATE UNIQUE INDEX clients_document_uq
  ON clients ("clubId", "documentType", "documentNumber")
  WHERE "documentNumber" IS NOT NULL AND "deletedAt" IS NULL;

CREATE UNIQUE INDEX products_sku_uq
  ON products ("clubId", sku)
  WHERE sku IS NOT NULL AND "deletedAt" IS NULL;

CREATE UNIQUE INDEX products_barcode_uq
  ON products ("clubId", barcode)
  WHERE barcode IS NOT NULL AND "deletedAt" IS NULL;

CREATE UNIQUE INDEX suppliers_tax_id_uq
  ON suppliers ("clubId", "taxId")
  WHERE "taxId" IS NOT NULL AND "deletedAt" IS NULL;

-- Un cliente no puede tener dos membresías activas del mismo plan.
CREATE UNIQUE INDEX client_memberships_active_uq
  ON client_memberships ("clubId", "clientId", "planId")
  WHERE status = 'ACTIVE';

-- ----------------------------------------------------------------------------
-- 7. NUMERACIÓN SECUENCIAL POR CLUB
--
-- Los códigos legibles (R-2026-00184, PAG-2026-00099) no pueden generarse
-- con COUNT(*)+1: dos requests simultáneas leen el mismo número y una de
-- las dos falla por unique — o peor, si no hubiera unique, se duplican.
--
-- Tampoco sirve una SEQUENCE global: cada club necesita su propia serie
-- empezando en 1, y la serie se reinicia por año.
--
-- Solución: tabla de contadores con UPDATE ... RETURNING, que toma un lock
-- de fila. Las requests concurrentes se serializan sobre esa fila y cada
-- una recibe un número distinto.
-- ----------------------------------------------------------------------------

CREATE TABLE document_counters (
  "clubId"   uuid    NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  doc_type  text    NOT NULL,   -- 'BOOKING' | 'PAYMENT' | 'SALE' | 'EXPENSE'
  period    text    NOT NULL,   -- '2026' o '2026-07' según el tipo
  last_value bigint NOT NULL DEFAULT 0,
  PRIMARY KEY ("clubId", doc_type, period)
);

ALTER TABLE document_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON document_counters
  USING ("clubId" = current_club_id())
  WITH CHECK ("clubId" = current_club_id());

-- Devuelve el próximo número de forma atómica.
-- El INSERT ... ON CONFLICT DO UPDATE crea el contador si no existe y lo
-- incrementa si existe, todo en una sola sentencia sin condición de carrera.
CREATE OR REPLACE FUNCTION next_document_number(
  p_club_id uuid,
  p_doc_type text,
  p_period text
) RETURNS bigint AS $$
DECLARE
  v_next bigint;
BEGIN
  INSERT INTO document_counters ("clubId", doc_type, period, last_value)
  VALUES (p_club_id, p_doc_type, p_period, 1)
  ON CONFLICT ("clubId", doc_type, period)
  DO UPDATE SET last_value = document_counters.last_value + 1
  RETURNING last_value INTO v_next;

  RETURN v_next;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 8. COHERENCIA DE MONTOS
-- ----------------------------------------------------------------------------

ALTER TABLE bookings
  ADD CONSTRAINT bookings_amounts_valid CHECK (
    "basePrice" >= 0
    AND "discountAmount" >= 0
    AND "totalPrice" >= 0
    AND "paidAmount" >= 0
    AND "discountAmount" <= "basePrice"
  );

ALTER TABLE payments
  ADD CONSTRAINT payments_amount_positive CHECK (amount > 0);

ALTER TABLE payments
  ADD CONSTRAINT payments_refund_within_amount
  CHECK ("refundedAmount" >= 0 AND "refundedAmount" <= amount);

-- ----------------------------------------------------------------------------
-- 9. BÚSQUEDA DE CLIENTES
--
-- Recepcion busca con el cliente al telefono: tiene que tolerar acentos
-- ausentes, mayusculas y errores de tipeo.
--
-- OJO CON translate(): opera sobre BYTES, no caracteres. Con UTF-8 cada
-- vocal acentuada ocupa 2 bytes, asi que translate() produce basura:
-- convierte Jose en josai y Gonzalez en gonzaalez. Hay que usar unaccent().
--
-- unaccent() es STABLE y no se puede indexar directamente; se envuelve en
-- un wrapper IMMUTABLE con el diccionario fijado explícitamente. El nombre
-- del diccionario debe ir literal (no depender del search_path) para que
-- la inmutabilidad sea real.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION immutable_unaccent(text)
RETURNS text AS $$
  SELECT public.unaccent('public.unaccent', $1)
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;

-- Texto de búsqueda: nombre, apellido, teléfono, documento y email, en
-- minúsculas y sin acentos. Columna generada: siempre en sincronía.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS search_text text
  GENERATED ALWAYS AS (
    lower(immutable_unaccent(
      coalesce("firstName",'') || ' ' || coalesce("lastName",'') || ' ' ||
      coalesce(phone,'') || ' ' || coalesce(whatsapp,'') || ' ' ||
      coalesce("documentNumber",'') || ' ' || coalesce(email,'')
    ))
  ) STORED;

DROP INDEX IF EXISTS clients_name_trgm;

CREATE INDEX clients_search_trgm
  ON clients USING gin (search_text gin_trgm_ops);

-- Orden alfabético del listado (default de la pantalla de clientes).
CREATE INDEX clients_alpha
  ON clients ("clubId", "lastName", "firstName")
  WHERE "deletedAt" IS NULL;

-- Cumpleaños del mes: se consulta a diario para campañas de saludo.
CREATE INDEX clients_birthday
  ON clients ("clubId", (EXTRACT(MONTH FROM "birthDate")), (EXTRACT(DAY FROM "birthDate")))
  WHERE "birthDate" IS NOT NULL AND "deletedAt" IS NULL;

-- Clientes inactivos: base del reporte de recuperación.
CREATE INDEX clients_inactive
  ON clients ("clubId", "lastVisitAt")
  WHERE "deletedAt" IS NULL AND status = 'ACTIVE';
