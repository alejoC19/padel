-- Las canchas nuevas quedaban con slotMinutes=30: la agenda del panel
-- terminaba mostrando un turno cada media hora (08:00-08:30, 08:30-09:00...)
-- en vez de en punto, distinto del portal del jugador (que ya usa pasos de
-- 60 min a propósito). Como no hay ninguna UI para elegir este valor, todas
-- las canchas existentes están en el default sin haberlo elegido a propósito
-- — el backfill es seguro.
ALTER TABLE "courts" ALTER COLUMN "slotMinutes" SET DEFAULT 60;

UPDATE "courts" SET "slotMinutes" = 60 WHERE "slotMinutes" = 30;
