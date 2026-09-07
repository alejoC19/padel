-- Extensiones requeridas por ClubOS.
-- btree_gist es obligatoria: sin ella el EXCLUDE constraint que impide
-- la doble reserva no se puede crear.
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- unaccent: normaliza acentos para la búsqueda de clientes.
-- NO usar translate() como alternativa: opera sobre bytes, no caracteres,
-- y con UTF-8 destroza las vocales acentuadas ('José' -> 'josai').
CREATE EXTENSION IF NOT EXISTS unaccent;
