-- Agrega DEFAULT gen_random_uuid() a la columna `id` de toda tabla que la
-- tenga como uuid sin default. Prisma Client ya genera el uuid del lado de
-- la app (@default(uuid()) en el schema) y siempre lo manda explícito, así
-- que esto no cambia nada para el camino normal — es una red de seguridad
-- para SQL crudo (scripts de administración, smoke tests) que inserte sin
-- especificar id: hoy eso falla con "null value in column id" porque no hay
-- default a nivel motor, solo a nivel Prisma.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'id'
      AND c.data_type = 'uuid'
      AND c.column_default IS NULL
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN id SET DEFAULT gen_random_uuid()', t);
  END LOOP;
END $$;

-- Mismo razonamiento para `updatedAt` (@updatedAt en el schema: Prisma la
-- pisa en cada create/update desde la app, pero un INSERT crudo que la omita
-- también choca contra NOT NULL sin esto).
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'updatedAt'
      AND c.data_type = 'timestamp with time zone'
      AND c.column_default IS NULL
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN "updatedAt" SET DEFAULT now()', t);
  END LOOP;
END $$;
