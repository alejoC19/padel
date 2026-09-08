-- Token de un solo uso para "olvidé mi contraseña" y para aceptar una
-- invitación de staff (la cuenta se crea sin contraseña; este token la fija
-- la primera vez). No es tenant-scoped: pertenece al usuario, no a un club
-- (mismo motivo que `users`/`sessions` — ver PLATFORM_MODELS en
-- prisma.service.ts), así que no lleva clubId ni política RLS.

-- CreateEnum
CREATE TYPE "PasswordResetPurpose" AS ENUM ('RESET', 'INVITE');

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "purpose" "PasswordResetPurpose" NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
