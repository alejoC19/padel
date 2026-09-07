#!/usr/bin/env bash
# =============================================================================
# restore.sh — restaura un backup de ClubOS
#
# Un backup que nunca restauraste NO es un backup. Este script existe para que
# pruebes la restauración ANTES de necesitarla de verdad. Corré esto contra una
# base de prueba cada tanto para confirmar que tus dumps sirven.
#
# Uso:
#   TARGET_DATABASE_URL=postgresql://... ./scripts/restore.sh ./backups/clubos_XXXX.dump
#
# ⚠️  Restaura SOBRE la base apuntada por TARGET_DATABASE_URL, reemplazando su
#     contenido. NUNCA la apuntes a producción para una prueba.
# =============================================================================
set -euo pipefail

: "${TARGET_DATABASE_URL:?Falta TARGET_DATABASE_URL (a dónde restaurar)}"

DUMP_FILE="${1:?Uso: restore.sh <archivo.dump>}"

if [[ ! -f "$DUMP_FILE" ]]; then
  echo "No existe el archivo: $DUMP_FILE" >&2
  exit 1
fi

# Salvaguarda: exigir confirmación si la URL parece de producción.
if [[ "$TARGET_DATABASE_URL" == *"prod"* ]]; then
  echo "⚠️  TARGET_DATABASE_URL contiene 'prod'. ¿Seguro? Escribí 'restaurar-prod' para continuar:"
  read -r CONFIRM
  [[ "$CONFIRM" == "restaurar-prod" ]] || { echo "Cancelado."; exit 1; }
fi

echo "[$(date -Is)] Restaurando ${DUMP_FILE} → base destino"

# --clean --if-exists: borra objetos previos antes de recrearlos.
pg_restore \
  --clean --if-exists \
  --no-owner --no-privileges \
  --dbname "$TARGET_DATABASE_URL" \
  "$DUMP_FILE"

echo "[$(date -Is)] Restauración completa."
echo "Recordá aplicar la migración de RLS si la base era nueva:"
echo "  psql \$TARGET_DATABASE_URL -f prisma/manual/001_integrity_and_rls.sql"
