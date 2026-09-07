#!/usr/bin/env bash
# =============================================================================
# setup-produccion.sh — prepara la base de datos en la nube (una sola vez).
#
# Se corre UNA VEZ, después de crear la base gestionada y antes del primer uso.
# Deja la base con el schema, las políticas de seguridad (RLS) y los datos base.
#
# Uso:
#   DATABASE_URL="postgresql://...tu-base-de-la-nube..." bash setup-produccion.sh
#
# La DATABASE_URL te la da el proveedor (Railway/Neon) al crear la base.
# =============================================================================
set -euo pipefail

: "${DATABASE_URL:?Falta DATABASE_URL (la connection string de tu base en la nube)}"

echo "▸ 1/4  Instalando dependencias"
npm ci

echo "▸ 2/4  Generando Prisma Client + creando tablas"
npx prisma generate
npx prisma db push --skip-generate

echo "▸ 3/4  Aplicando seguridad multi-tenant (RLS)"
# psql tiene que estar disponible. Si no lo tenés local, corré este paso desde
# el panel del proveedor (casi todos dan una consola SQL / psql web).
if command -v psql >/dev/null 2>&1; then
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/rls/001_integrity_and_rls.sql
  echo "  ✔ RLS aplicada."
else
  echo "  ⚠ psql no está instalado localmente."
  echo "    Aplicá manualmente el archivo prisma/rls/001_integrity_and_rls.sql"
  echo "    desde la consola SQL de tu proveedor (Railway/Neon la tienen)."
fi

echo "▸ 4/4  Sembrando datos base (planes — sin club demo en producción)"
NODE_ENV=production npx ts-node prisma/seed.ts || echo "  ⚠ Seed falló o ya estaba sembrado."

echo ""
echo "✅ Base de producción lista."
echo "   Ahora configurá las variables de entorno en el hosting y desplegá."
