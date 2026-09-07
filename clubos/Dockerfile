# =============================================================================
# ClubOS API — Dockerfile de producción (multi-stage)
#
# Objetivos: imagen chica, sin devDependencies en runtime, usuario no-root,
# Prisma Client generado en build. La migración se corre aparte (ver README),
# no en el arranque del contenedor, para no acoplar deploy y migración.
# =============================================================================

# ---- Stage 1: build ----
FROM node:20-slim AS builder
WORKDIR /app

# OpenSSL: Prisma lo necesita para generar el engine correcto.
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN npm run build

# Descartar devDependencies para el runtime.
RUN npm prune --omit=dev

# ---- Stage 2: runtime ----
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Usuario no-root: si alguien escapa del proceso, no es root en el contenedor.
RUN groupadd -r clubos && useradd -r -g clubos clubos

COPY --from=builder --chown=clubos:clubos /app/node_modules ./node_modules
COPY --from=builder --chown=clubos:clubos /app/dist ./dist
COPY --from=builder --chown=clubos:clubos /app/prisma ./prisma
COPY --from=builder --chown=clubos:clubos /app/package.json ./package.json

USER clubos

EXPOSE 3000

# Healthcheck del contenedor (además del que consulta el orquestador).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
