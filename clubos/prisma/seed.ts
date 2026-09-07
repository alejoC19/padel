/**
 * Seed de ClubOS.
 *
 *   npx prisma db seed              → planes + club demo completo
 *   SEED_MODE=platform npx ...      → solo planes de plataforma
 *
 * Idempotente: se puede correr N veces sin duplicar.
 */
import { PrismaClient } from '@prisma/client';
import { ROLE_PRESETS } from '../src/common/permissions';

// El seed crea clubes, planes y membresías de punta a punta: es una
// operación de plataforma, no de un tenant. Se conecta con DIRECT_URL (rol
// owner) en vez de DATABASE_URL (rol clubos_app, el que usa el backend en
// runtime), porque clubos_app está sujeto a RLS y sin `app.current_club_id`
// seteado (esto no pasa por PrismaService ni por AsyncLocalStorage) toda
// escritura a una tabla tenant-scoped sería rechazada por la policy.
const prisma = new PrismaClient({
  datasourceUrl: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
});

// ---------------------------------------------------------------------------
// Planes de la plataforma
// ---------------------------------------------------------------------------
async function seedPlans() {
  const plans = [
    {
      code: 'starter',
      name: 'Starter',
      description: 'Para clubes que arrancan',
      priceMonthly: 45000,
      priceYearly: 459000,
      maxCourts: 3,
      maxUsers: 3,
      maxClients: 400,
      storageMb: 1024,
      features: {
        bookings: true,
        cash: true,
        crm: true,
        products: false,
        tournaments: false,
        invoicing: false,
        whatsapp: false,
        analytics: 'basic',
      },
      sortOrder: 1,
    },
    {
      code: 'pro',
      name: 'Pro',
      description: 'Gestión completa del club',
      priceMonthly: 89000,
      priceYearly: 899000,
      maxCourts: 10,
      maxUsers: 15,
      maxClients: 5000,
      storageMb: 10240,
      features: {
        bookings: true,
        cash: true,
        crm: true,
        products: true,
        tournaments: true,
        invoicing: true,
        whatsapp: true,
        analytics: 'full',
      },
      sortOrder: 2,
    },
    {
      code: 'enterprise',
      name: 'Enterprise',
      description: 'Multi-sede y soporte dedicado',
      priceMonthly: 189000,
      priceYearly: 1899000,
      maxCourts: -1,
      maxUsers: -1,
      maxClients: -1,
      storageMb: 102400,
      features: {
        bookings: true,
        cash: true,
        crm: true,
        products: true,
        tournaments: true,
        invoicing: true,
        whatsapp: true,
        analytics: 'full',
        multiVenue: true,
        api: true,
      },
      sortOrder: 3,
    },
  ];

  for (const p of plans) {
    await prisma.plan.upsert({
      where: { code: p.code },
      update: p,
      create: p,
    });
  }
  console.log(`✓ ${plans.length} planes`);
}

// ---------------------------------------------------------------------------
// Defaults que TODO club nuevo recibe al crearse.
// Esta función es la que llama el onboarding en producción.
// ---------------------------------------------------------------------------
export async function seedClubDefaults(clubId: string) {
  // --- Roles del sistema ---
  const roleDefs = [
    { code: 'OWNER' as const, name: 'Dueño' },
    { code: 'ADMIN' as const, name: 'Administrador' },
    { code: 'RECEPTION' as const, name: 'Recepción' },
    { code: 'INSTRUCTOR' as const, name: 'Profesor' },
    { code: 'CLIENT' as const, name: 'Cliente' },
  ];

  for (const r of roleDefs) {
    await prisma.role.upsert({
      where: { clubId_code: { clubId, code: r.code } },
      update: { permissions: ROLE_PRESETS[r.code] },
      create: {
        clubId,
        code: r.code,
        name: r.name,
        permissions: ROLE_PRESETS[r.code],
        isSystem: true,
      },
    });
  }

  // --- Medios de pago ---
  // Las comisiones y días de acreditación son valores reales de plaza (AR).
  // El club los ajusta después, pero arrancar en 0 distorsiona la
  // rentabilidad desde el día uno.
  const methods = [
    { code: 'CASH', name: 'Efectivo', kind: 'CASH' as const, feePercent: 0, settlementDays: 0, affectsCashCount: true, sortOrder: 1 },
    { code: 'MP_QR', name: 'Mercado Pago QR', kind: 'QR' as const, feePercent: 0.8, settlementDays: 1, affectsCashCount: false, sortOrder: 2 },
    { code: 'MP_LINK', name: 'Mercado Pago Link', kind: 'MERCADO_PAGO' as const, feePercent: 5.49, settlementDays: 1, affectsCashCount: false, sortOrder: 3 },
    { code: 'DEBIT', name: 'Tarjeta de Débito', kind: 'DEBIT_CARD' as const, feePercent: 1.8, settlementDays: 1, affectsCashCount: false, sortOrder: 4 },
    { code: 'CREDIT', name: 'Tarjeta de Crédito', kind: 'CREDIT_CARD' as const, feePercent: 3.5, settlementDays: 18, affectsCashCount: false, sortOrder: 5 },
    { code: 'TRANSFER', name: 'Transferencia', kind: 'BANK_TRANSFER' as const, feePercent: 0, settlementDays: 0, affectsCashCount: false, sortOrder: 6 },
    { code: 'ACCOUNT', name: 'Cuenta Corriente', kind: 'ACCOUNT_CREDIT' as const, feePercent: 0, settlementDays: 0, affectsCashCount: false, sortOrder: 7 },
  ];

  for (const m of methods) {
    await prisma.paymentMethod.upsert({
      where: { clubId_code: { clubId, code: m.code } },
      update: {},
      create: { clubId, ...m },
    });
  }

  // --- Deporte por defecto ---
  await prisma.sport.upsert({
    where: { clubId_code: { clubId, code: 'PADEL' } },
    update: {},
    create: {
      clubId,
      code: 'PADEL',
      name: 'Pádel',
      defaultPlayers: 4,
      defaultDuration: 90,
      sortOrder: 1,
    },
  });

  // --- Etiquetas automáticas del CRM ---
  const tags = [
    { code: 'VIP', name: 'VIP', color: '#F59E0B', isAuto: true },
    { code: 'FREQUENT', name: 'Frecuente', color: '#10B981', isAuto: true },
    { code: 'NEW', name: 'Nuevo', color: '#3B82F6', isAuto: true },
    { code: 'INACTIVE', name: 'Inactivo', color: '#6B7280', isAuto: true },
    { code: 'AT_RISK', name: 'En riesgo', color: '#EF4444', isAuto: true },
    { code: 'DEBTOR', name: 'Moroso', color: '#DC2626', isAuto: true },
    { code: 'CORPORATE', name: 'Corporativo', color: '#8B5CF6', isAuto: false },
  ];

  for (const t of tags) {
    await prisma.clientTag.upsert({
      where: { clubId_code: { clubId, code: t.code } },
      update: {},
      create: { clubId, ...t },
    });
  }

  // --- Categorías de gasto ---
  // isFixed permite calcular punto de equilibrio sin reclasificar después.
  const expenseCats = [
    { name: 'Alquiler', isFixed: true, sortOrder: 1 },
    { name: 'Sueldos', isFixed: true, sortOrder: 2 },
    { name: 'Servicios (luz, agua, gas)', isFixed: false, sortOrder: 3 },
    { name: 'Internet y telefonía', isFixed: true, sortOrder: 4 },
    { name: 'Mantenimiento', isFixed: false, sortOrder: 5 },
    { name: 'Insumos deportivos', isFixed: false, sortOrder: 6 },
    { name: 'Limpieza', isFixed: false, sortOrder: 7 },
    { name: 'Impuestos y tasas', isFixed: true, sortOrder: 8 },
    { name: 'Publicidad', isFixed: false, sortOrder: 9 },
    { name: 'Mercadería para reventa', isFixed: false, sortOrder: 10 },
    { name: 'Otros', isFixed: false, sortOrder: 99 },
  ];

  for (const c of expenseCats) {
    await prisma.expenseCategory.upsert({
      where: { clubId_name: { clubId, name: c.name } },
      update: {},
      create: { clubId, ...c },
    });
  }

  // --- Categorías de producto ---
  for (const [i, name] of ['Bebidas', 'Snacks', 'Paletas', 'Pelotas', 'Accesorios', 'Alquiler'].entries()) {
    await prisma.productCategory.upsert({
      where: { clubId_name: { clubId, name } },
      update: {},
      create: { clubId, name, sortOrder: i + 1 },
    });
  }

  // --- Caja por defecto ---
  await prisma.cashRegister.upsert({
    where: { clubId_name: { clubId, name: 'Recepción' } },
    update: {},
    create: { clubId, name: 'Recepción' },
  });

  // --- Horarios: lun-vie 8-24, sáb-dom 9-23 ---
  //
  // OJO: no se usa upsert acá. En Postgres, NULL != NULL dentro de un
  // UNIQUE, así que el constraint (clubId, courtId, dayOfWeek, openMinute)
  // NO impide duplicados cuando courtId es NULL — y el upsert por esa clave
  // tampoco matchea nunca. Se resuelve buscando primero.
  for (let day = 0; day <= 6; day++) {
    const isWeekend = day === 0 || day === 6;
    const openMinute = isWeekend ? 9 * 60 : 8 * 60;
    const closeMinute = isWeekend ? 23 * 60 : 24 * 60;

    const existing = await prisma.operatingHour.findFirst({
      where: { clubId, courtId: null, dayOfWeek: day },
    });

    if (existing) {
      await prisma.operatingHour.update({
        where: { id: existing.id },
        data: { openMinute, closeMinute },
      });
    } else {
      await prisma.operatingHour.create({
        data: { clubId, dayOfWeek: day, openMinute, closeMinute },
      });
    }
  }

  // --- Lista de precios por defecto ---
  const priceList = await prisma.priceList.upsert({
    where: { clubId_name: { clubId, name: 'General' } },
    update: {},
    create: { clubId, name: 'General', isDefault: true },
  });

  return { priceListId: priceList.id };
}

// ---------------------------------------------------------------------------
// Club demo (solo desarrollo)
// ---------------------------------------------------------------------------
async function seedDemoClub() {
  const bcrypt = await import('bcryptjs');
  const proPlan = await prisma.plan.findUniqueOrThrow({ where: { code: 'pro' } });

  const club = await prisma.club.upsert({
    where: { slug: 'demo' },
    update: {},
    create: {
      slug: 'demo',
      name: 'Club Demo Pádel',
      legalName: 'Club Demo S.R.L.',
      taxId: '30712345678',
      taxRegime: 'RESPONSABLE_INSCRIPTO',
      email: 'hola@clubdemo.com.ar',
      phone: '+541145678900',
      addressCity: 'San Isidro',
      addressState: 'Buenos Aires',
      status: 'ACTIVE',
      planId: proPlan.id,
    },
  });

  const { priceListId } = await seedClubDefaults(club.id);

  const owner = await prisma.user.upsert({
    where: { email: 'owner@clubdemo.com.ar' },
    update: {},
    create: {
      email: 'owner@clubdemo.com.ar',
      emailVerified: true,
      passwordHash: await bcrypt.hash('Demo1234!', 12),
      firstName: 'Martín',
      lastName: 'Gómez',
    },
  });

  const ownerRole = await prisma.role.findUniqueOrThrow({
    where: { clubId_code: { clubId: club.id, code: 'OWNER' } },
  });

  await prisma.membership.upsert({
    where: { clubId_userId: { clubId: club.id, userId: owner.id } },
    update: {},
    create: {
      clubId: club.id,
      userId: owner.id,
      roleId: ownerRole.id,
      status: 'ACTIVE',
      acceptedAt: new Date(),
    },
  });

  const sport = await prisma.sport.findUniqueOrThrow({
    where: { clubId_code: { clubId: club.id, code: 'PADEL' } },
  });

  const colors = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6'];
  for (let n = 1; n <= 4; n++) {
    await prisma.court.upsert({
      where: { clubId_number: { clubId: club.id, number: n } },
      update: {},
      create: {
        clubId: club.id,
        sportId: sport.id,
        name: `Cancha ${n}`,
        number: n,
        environment: n <= 2 ? 'INDOOR' : 'OUTDOOR',
        surface: 'SYNTHETIC_GRASS',
        color: colors[n - 1],
        sortOrder: n,
      },
    });
  }

  // Precios: base + recargo en horario pico (después de las 18).
  const existing = await prisma.priceRule.count({ where: { priceListId } });
  if (existing === 0) {
    await prisma.priceRule.createMany({
      data: [
        { clubId: club.id, priceListId, durationMinutes: 90, price: 18000, priority: 0 },
        { clubId: club.id, priceListId, durationMinutes: 60, price: 13000, priority: 0 },
        { clubId: club.id, priceListId, durationMinutes: 90, fromMinute: 18 * 60, toMinute: 24 * 60, price: 24000, priority: 10 },
        { clubId: club.id, priceListId, durationMinutes: 90, dayOfWeek: 6, price: 26000, priority: 20 },
        { clubId: club.id, priceListId, durationMinutes: 90, dayOfWeek: 0, price: 26000, priority: 20 },
      ],
    });
  }

  console.log(`✓ Club demo: ${club.slug} | owner@clubdemo.com.ar / Demo1234!`);
}

async function main() {
  await seedPlans();
  // El club demo (con contraseña conocida) es SOLO para desarrollo.
  // No se crea en producción ni con SEED_MODE=platform, para no dejar una
  // cuenta con credenciales conocidas en una base real.
  const isProd = process.env.NODE_ENV === 'production';
  if (process.env.SEED_MODE !== 'platform' && !isProd) {
    await seedDemoClub();
  } else {
    console.log('  (club demo omitido: producción o SEED_MODE=platform)');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
