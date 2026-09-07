-- AlterTable
ALTER TABLE "bookings" ADD COLUMN "accessTokenHash" VARCHAR(64);

-- CreateIndex
CREATE UNIQUE INDEX "bookings_accessTokenHash_key" ON "bookings"("accessTokenHash");
