#!/usr/bin/env bash
# =============================================================================
# setup-produccion.sh — prepara la base de datos en la nube (una sola vez).
#
# Se corre UNA VEZ, después de crear la base gestionada y antes del primer uso.
# Deja la base con el schema, las políticas de seguridad (RLS), el rol
# restringido de la app, y los datos base.
#
# Uso:
#   DATABASE_URL="postgresql://...tu-base-de-la-nube..." bash setup-produccion.sh
#
# La DATABASE_URL te la da el proveedor (Railway/Neon) al crear la base —
# ESA es la del owner/admin, la que este script usa para crear todo. NO es
# la que va a usar la aplicación en runtime (ver el paso final).
# =============================================================================
set -euo pipefail

: "${DATABASE_URL:?Falta DATABASE_URL (la connection string de tu base en la nube, la del owner/admin)}"
APP_DB_PASSWORD="${APP_DB_PASSWORD:-$(openssl rand -hex 24)}"

echo "▸ 1/5  Instalando dependencias"
npm ci

echo "▸ 2/5  Generando Prisma Client + aplicando migraciones"
# DIRECT_URL = la misma que DATABASE_URL acá: es el rol owner, el único con
# permiso para crear tablas. Una vez desplegada la app, DIRECT_URL y
# DATABASE_URL van a ser DOS conexiones distintas — ver el paso final.
export DIRECT_URL="$DATABASE_URL"
npx prisma generate
npx prisma migrate deploy

echo "▸ 3/5  Rol restringido de la app + seguridad multi-tenant (RLS)"
# psql tiene que estar disponible. Si no lo tenés local, corré este paso desde
# el panel del proveedor (casi todos dan una consola SQL / psql web) — pero
# NO te lo saltees: sin esto, `clubos_app` no existe y la app no puede
# conectarse, o peor, alguien la hace correr con el rol owner y RLS queda
# bypasseada por completo (ver README "Conexión: usar el rol correcto").
if command -v psql >/dev/null 2>&1; then
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/init/01-extensions.sql
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/init/02-app-role.sql
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -c "ALTER ROLE clubos_app WITH PASSWORD '${APP_DB_PASSWORD}';"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual/001_integrity_and_rls.sql
  echo "  ✔ Rol clubos_app creado y RLS aplicada."
else
  echo "  ⚠ psql no está instalado localmente. Aplicá manualmente, EN ESTE ORDEN,"
  echo "    desde la consola SQL de tu proveedor (Railway/Neon la tienen):"
  echo "      1) db/init/01-extensions.sql"
  echo "      2) db/init/02-app-role.sql"
  echo "      3) ALTER ROLE clubos_app WITH PASSWORD 'elegí-una-clave-segura';"
  echo "      4) prisma/manual/001_integrity_and_rls.sql"
  APP_DB_PASSWORD="<la-que-hayas-puesto-en-el-paso-3>"
fi

echo "▸ 4/5  Sembrando datos base (planes — sin club demo en producción)"
# El seed corre como owner (DIRECT_URL), no como clubos_app: da de alta
# planes/clubes, que son operaciones de plataforma sujetas a las mismas
# reglas que runWithoutTenancy en el backend.
NODE_ENV=production npx ts-node prisma/seed.ts || echo "  ⚠ Seed falló o ya estaba sembrado."

echo "▸ 5/5  Listo — variables de entorno para el hosting"
# Reescribe la URL del owner con el usuario clubos_app y la contraseña de
# arriba, preservando host/puerto/base/query string.
APP_DATABASE_URL=$(python3 - "$DATABASE_URL" "$APP_DB_PASSWORD" <<'PYEOF'
import sys
from urllib.parse import urlsplit, urlunsplit
url, password = sys.argv[1], sys.argv[2]
parts = urlsplit(url)
netloc = f"clubos_app:{password}@{parts.hostname}"
if parts.port:
    netloc += f":{parts.port}"
print(urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment)))
PYEOF
)

echo ""
echo "✅ Base de producción lista."
echo ""
echo "Configurá estas DOS variables en el hosting del backend (son distintas,"
echo "no la misma URL dos veces — ver README \"Conexión: usar el rol correcto\"):"
echo ""
echo "  DATABASE_URL=${APP_DATABASE_URL}"
echo "  DIRECT_URL=${DATABASE_URL}"
echo ""
echo "DATABASE_URL (rol clubos_app) es la que usa la app en runtime, sujeta a"
echo "RLS. DIRECT_URL (rol owner) solo la usan las migraciones futuras — nunca"
echo "la app. Guardá la contraseña de clubos_app en un gestor de secretos: no"
echo "queda guardada en ningún archivo por este script."
