-- App del jugador: inscripción pública a torneos (comprobante sin login,
-- mismo patrón que bookings.accessTokenHash) y pago de la inscripción vía
-- PaymentOrder (mismo circuito que el pago online de una reserva).

-- AlterTable
ALTER TABLE "tournament_teams" ADD COLUMN "accessTokenHash" VARCHAR(64);

-- CreateIndex
CREATE UNIQUE INDEX "tournament_teams_accessTokenHash_key" ON "tournament_teams"("accessTokenHash");

-- AlterTable
ALTER TABLE "payment_orders" ADD COLUMN "teamId" UUID;

-- AddForeignKey
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "tournament_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "payment_orders_teamId_idx" ON "payment_orders"("teamId");
