#!/usr/bin/env bash
# =============================================================================
# start.sh — Setup COMPLETO del backend de ClubOS, a prueba de tropiezos.
#
# Hace TODO en orden y resuelve solo los problemas típicos de Windows/dev:
#   - detecta si el puerto 5432 está ocupado (Postgres local) y usa 5433
#   - arma el .env con los valores correctos (puertos, CORS, secretos)
#   - levanta Postgres + Redis y ESPERA a que estén sanos
#   - instala dependencias, genera Prisma, crea las tablas, siembra datos
#
# Uso (parado en la carpeta clubos/):
#   bash start.sh
#
# Es idempotente: podés correrlo las veces que quieras.
# Requiere: Node 20+, Docker Desktop ABIERTO.
# =============================================================================
set -euo pipefail

echo "════════════════════════════════════════════"
echo "  ClubOS — setup de desarrollo"
echo "════════════════════════════════════════════"

# --- 0. Chequeos previos -----------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  echo "✗ Docker no está disponible. Abrí Docker Desktop y volvé a intentar."
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "✗ Docker Desktop no está corriendo. Abrilo y esperá a que diga 'running'."
  exit 1
fi

# --- 1. Elegir puerto de Postgres (5432, o 5433 si está ocupado) -------------
DB_PORT=5432
if docker ps --format '{{.Ports}}' | grep -q '0.0.0.0:5432' \
   || (command -v netstat >/dev/null 2>&1 && netstat -an 2>/dev/null | grep -q '[.:]5432 .*LISTEN'); then
  DB_PORT=5433
  echo "▸ El puerto 5432 está ocupado (tenés otro Postgres). Uso 5433."
else
  echo "▸ Puerto de base: 5432"
fi
export DB_PASSWORD="${DB_PASSWORD:-clubos_dev}"
# DIRECT_URL (owner): DDL — migrate, RLS. DATABASE_URL (clubos_app): runtime
# del backend, sujeto a RLS. Si el backend corriera como owner, RLS quedaría
# bypasseada y un club podría leer datos de otro sin que ningún test lo note
# (ver README "Conexión: usar el rol correcto"). clubos_app lo crea
# db/init/02-app-role.sql con password 'clubos_dev' fijo — si cambiás
# DB_PASSWORD acá, actualizá también ese archivo.
export DIRECT_URL="postgresql://clubos_owner:${DB_PASSWORD}@localhost:${DB_PORT}/clubos?schema=public"
export DATABASE_URL="postgresql://clubos_app:clubos_dev@localhost:${DB_PORT}/clubos?schema=public"

# --- 2. docker-compose: fijar el puerto elegido ------------------------------
# Reescribe la línea de mapeo de puerto del servicio db a "<DB_PORT>:5432".
if [[ "$(uname)" == "Darwin" ]]; then SED=(sed -i ""); else SED=(sed -i); fi
"${SED[@]}" -E "s|\"[0-9]+:5432\"|\"${DB_PORT}:5432\"|" docker-compose.yml

# --- 3. .env -----------------------------------------------------------------
echo "▸ Escribiendo .env"
cp .env.example .env
"${SED[@]}" "s|^DATABASE_URL=.*|DATABASE_URL=${DATABASE_URL}|" .env
"${SED[@]}" "s|^DIRECT_URL=.*|DIRECT_URL=${DIRECT_URL}|" .env
"${SED[@]}" "s|^PORT=.*|PORT=3000|" .env
"${SED[@]}" "s|^API_PUBLIC_URL=.*|API_PUBLIC_URL=http://localhost:3000|" .env
"${SED[@]}" "s|^WEB_PUBLIC_URL=.*|WEB_PUBLIC_URL=http://localhost:3001|" .env
"${SED[@]}" "s|^CORS_ORIGINS=.*|CORS_ORIGINS=http://localhost:3001|" .env
"${SED[@]}" "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=$(openssl rand -base64 48 | tr -d '\n/')|" .env
"${SED[@]}" "s|^PAYMENTS_ENC_KEY=.*|PAYMENTS_ENC_KEY=$(openssl rand -base64 48 | tr -d '\n/')|" .env

# --- 4. Levantar base + Redis y esperar a que estén sanos --------------------
echo "▸ Levantando Postgres + Redis"
docker compose up -d db redis
echo "▸ Esperando a que Postgres esté listo..."
for i in $(seq 1 40); do
  if docker compose exec -T db pg_isready -U clubos_owner -d clubos >/dev/null 2>&1; then
    echo "  ✔ Postgres listo (puerto ${DB_PORT})."
    break
  fi
  sleep 1
  [[ $i -eq 40 ]] && { echo "  ✗ Postgres no respondió. ¿Docker Desktop está bien?"; exit 1; }
done

# --- 5. Dependencias + Prisma ------------------------------------------------
echo "▸ Instalando dependencias (puede tardar unos minutos la primera vez)"
npm install

echo "▸ Generando Prisma Client"
npx prisma generate

echo "▸ Extensiones y rol clubos_app"
docker compose exec -T db psql -U clubos_owner -d clubos < db/init/01-extensions.sql >/dev/null
docker compose exec -T db psql -U clubos_owner -d clubos < db/init/02-app-role.sql >/dev/null

echo "▸ Aplicando migraciones"
npx prisma migrate deploy

# --- 6. RLS -------------------------------------------------------------
# NO es opcional: sin esto, `clubos_app` (el rol con el que corre el
# backend) no puede ni escribir (RLS con FORCE rechaza el INSERT) ni ver
# datos scoped al club. Si esto falla, el arranque tiene que fallar: un
# backend corriendo sin RLS aplicada silenciosamente "funciona" pero deja
# de aislar tenants.
echo "▸ Aplicando políticas RLS"
docker compose exec -T db psql -v ON_ERROR_STOP=1 -U clubos_owner -d clubos \
  < prisma/manual/001_integrity_and_rls.sql >/dev/null

# --- 7. Seed -----------------------------------------------------------------
echo "▸ Sembrando datos base"
npx ts-node prisma/seed.ts || echo "  ⚠ Seed falló o ya estaba sembrado."

echo ""
echo "════════════════════════════════════════════"
echo "  ✅ Backend listo."
echo ""
echo "  Arrancá la API con:"
echo "      npm run start:dev"
echo ""
echo "  Debe decir:  ClubOS API escuchando en :3000"
echo "  Probá:       http://localhost:3000/health"
echo "════════════════════════════════════════════"
