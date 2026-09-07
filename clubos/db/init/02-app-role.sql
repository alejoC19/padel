-- Rol de aplicación: sujeto a RLS.
--
-- El backend DEBE conectarse con este rol, nunca con el owner. El owner
-- bypassea las políticas RLS salvo que estén en FORCE (lo están), pero
-- usar el rol correcto es defensa en profundidad: si alguien quita el
-- FORCE en una migración futura, el aislamiento sigue en pie.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clubos_app') THEN
    CREATE ROLE clubos_app LOGIN PASSWORD 'clubos_dev';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO clubos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO clubos_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO clubos_app;

-- Aplica también a las tablas que cree Prisma después de este script.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO clubos_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO clubos_app;
