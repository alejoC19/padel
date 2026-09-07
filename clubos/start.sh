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
export DATABASE_URL="postgresql://clubos_owner:${DB_PASSWORD}@localhost:${DB_PORT}/clubos?schema=public"

# --- 2. docker-compose: fijar el puerto elegido ------------------------------
# Reescribe la línea de mapeo de puerto del servicio db a "<DB_PORT>:5432".
if [[ "$(uname)" == "Darwin" ]]; then SED=(sed -i ""); else SED=(sed -i); fi
"${SED[@]}" -E "s|\"[0-9]+:5432\"|\"${DB_PORT}:5432\"|" docker-compose.yml

# --- 3. .env -----------------------------------------------------------------
echo "▸ Escribiendo .env"
cp .env.example .env
"${SED[@]}" "s|^DATABASE_URL=.*|DATABASE_URL=${DATABASE_URL}|" .env
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

echo "▸ Creando tablas (db push)"
npx prisma db push --skip-generate

# --- 6. RLS (opcional; no frena el arranque si falla) ------------------------
if [[ -f prisma/rls/001_integrity_and_rls.sql ]]; then
  echo "▸ Aplicando políticas RLS (si falla, seguimos igual)"
  docker compose exec -T db psql -U clubos_owner -d clubos < prisma/rls/001_integrity_and_rls.sql >/dev/null 2>&1 \
    && echo "  ✔ RLS aplicada." \
    || echo "  ⚠ RLS no se aplicó del todo (no bloquea el desarrollo)."
fi

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
