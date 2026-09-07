#!/usr/bin/env bash
# start.sh — prepara el frontend de ClubOS.
# Uso (parado en clubos-next/):  bash start.sh
set -euo pipefail
echo "▸ Configurando .env.local (API en :3000)"
cp .env.local.example .env.local
echo "▸ Instalando dependencias"
npm install
echo ""
echo "✅ Frontend listo. Arrancalo con:"
echo "      npm run dev"
echo ""
echo "  Corre en:  http://localhost:3001"
echo "  Entrá a:   http://localhost:3001/crear-club"
