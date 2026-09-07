#!/usr/bin/env bash
# =============================================================================
# backup.sh — respaldo de la base de ClubOS
#
# Hace un dump comprimido de Postgres, lo sube a S3 (si hay credenciales) y
# borra los backups locales viejos. Pensado para correr por cron diario.
#
# Uso:
#   DATABASE_URL=postgresql://... ./scripts/backup.sh
#   # opcional para subir a S3:
#   BACKUP_S3_BUCKET=s3://mi-bucket/clubos ./scripts/backup.sh
#
# Cron sugerido (3 AM, hora del server):
#   0 3 * * * cd /app && DATABASE_URL=$DATABASE_URL ./scripts/backup.sh >> /var/log/clubos-backup.log 2>&1
# =============================================================================
set -euo pipefail

: "${DATABASE_URL:?Falta DATABASE_URL}"

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
FILENAME="clubos_${TIMESTAMP}.dump"
FILEPATH="${BACKUP_DIR}/${FILENAME}"

mkdir -p "$BACKUP_DIR"

echo "[$(date -Is)] Iniciando backup → ${FILEPATH}"

# Formato custom (-Fc): comprimido y restaurable selectivamente con pg_restore.
pg_dump "$DATABASE_URL" -Fc --no-owner --no-privileges -f "$FILEPATH"

SIZE="$(du -h "$FILEPATH" | cut -f1)"
echo "[$(date -Is)] Backup local OK (${SIZE})"

# Subir a S3 si está configurado (requiere aws cli con credenciales).
if [[ -n "${BACKUP_S3_BUCKET:-}" ]]; then
  echo "[$(date -Is)] Subiendo a ${BACKUP_S3_BUCKET}/${FILENAME}"
  aws s3 cp "$FILEPATH" "${BACKUP_S3_BUCKET}/${FILENAME}"
  echo "[$(date -Is)] Subida OK"
fi

# Limpieza de backups locales viejos.
find "$BACKUP_DIR" -name 'clubos_*.dump' -type f -mtime "+${RETENTION_DAYS}" -delete
echo "[$(date -Is)] Backups locales de más de ${RETENTION_DAYS} días eliminados"

echo "[$(date -Is)] Backup completo."
