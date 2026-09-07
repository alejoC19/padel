import type { Prisma } from '@prisma/client';
import { ROLE_PRESETS } from '../../common/permissions';

/**
 * Siembra la configuración por defecto de un club recién creado, DENTRO de una
 * transacción. Es la versión transaccional de `seedClubDefaults` del seed:
 * misma config, pero recibe `tx` para que el alta del club sea atómica
 * (si algo falla, no queda un club a medio armar).
 *
 * Crea: roles del sistema, medios de pago, deporte pádel, etiquetas de CRM,
 * categorías de gasto y producto, caja, horarios y lista de precios.
 *
 * Devuelve ids que el onboarding necesita después (rol OWNER, deporte, lista).
 */
export async function seedClubDefaultsTx(
  tx: Prisma.TransactionClient,
  clubId: string,
): Promise<{ ownerRoleId: string; sportId: string; priceListId: string }> {
  // --- Roles del sistema ---
  const roleDefs = [
    { code: 'OWNER' as const, name: 'Dueño' },
    { code: 'ADMIN' as const, name: 'Administrador' },
    { code: 'RECEPTION' as const, name: 'Recepción' },
    { code: 'INSTRUCTOR' as const, name: 'Profesor' },
    { code: 'CLIENT' as const, name: 'Cliente' },
  ];

  let ownerRoleId = '';
  for (const r of roleDefs) {
    const role = await tx.role.create({
      data: {
        clubId,
        code: r.code,
        name: r.name,
        permissions: ROLE_PRESETS[r.code],
        isSystem: true,
      },
      select: { id: true, code: true },
    });
    if (role.code === 'OWNER') ownerRoleId = role.id;
  }

  // --- Medios de pago (comisiones reales de plaza AR) ---
  const methods = [
    { code: 'CASH', name: 'Efectivo', kind: 'CASH' as const, feePercent: 0, settlementDays: 0, affectsCashCount: true, sortOrder: 1 },
    { code: 'MP_QR', name: 'Mercado Pago QR', kind: 'QR' as const, feePercent: 0.8, settlementDays: 1, affectsCashCount: false, sortOrder: 2 },
    { code: 'MP_LINK', name: 'Mercado Pago', kind: 'MERCADO_PAGO' as const, feePercent: 5.49, settlementDays: 1, affectsCashCount: false, sortOrder: 3 },
    { code: 'DEBIT', name: 'Tarjeta de Débito', kind: 'DEBIT_CARD' as const, feePercent: 1.8, settlementDays: 1, affectsCashCount: false, sortOrder: 4 },
    { code: 'CREDIT', name: 'Tarjeta de Crédito', kind: 'CREDIT_CARD' as const, feePercent: 3.5, settlementDays: 18, affectsCashCount: false, sortOrder: 5 },
    { code: 'TRANSFER', name: 'Transferencia', kind: 'BANK_TRANSFER' as const, feePercent: 0, settlementDays: 0, affectsCashCount: false, sortOrder: 6 },
    { code: 'ACCOUNT', name: 'Cuenta Corriente', kind: 'ACCOUNT_CREDIT' as const, feePercent: 0, settlementDays: 0, affectsCashCount: false, sortOrder: 7 },
  ];
  for (const m of methods) {
    await tx.paymentMethod.create({ data: { clubId, ...m } });
  }

  // --- Deporte por defecto ---
  const sport = await tx.sport.create({
    data: {
      clubId,
      code: 'PADEL',
      name: 'Pádel',
      defaultPlayers: 4,
      defaultDuration: 90,
      sortOrder: 1,
    },
    select: { id: true },
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
    await tx.clientTag.create({ data: { clubId, ...t } });
  }

  // --- Categorías de gasto ---
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
    await tx.expenseCategory.create({ data: { clubId, ...c } });
  }

  // --- Categorías de producto ---
  const prodCats = ['Bebidas', 'Snacks', 'Paletas', 'Pelotas', 'Accesorios', 'Alquiler'];
  for (let i = 0; i < prodCats.length; i++) {
    await tx.productCategory.create({
      data: { clubId, name: prodCats[i], sortOrder: i + 1 },
    });
  }

  // --- Caja por defecto ---
  await tx.cashRegister.create({ data: { clubId, name: 'Recepción' } });

  // --- Horarios: lun-vie 8-24, sáb-dom 9-23 ---
  for (let day = 0; day <= 6; day++) {
    const isWeekend = day === 0 || day === 6;
    await tx.operatingHour.create({
      data: {
        clubId,
        dayOfWeek: day,
        openMinute: isWeekend ? 9 * 60 : 8 * 60,
        closeMinute: isWeekend ? 23 * 60 : 24 * 60,
      },
    });
  }

  // --- Lista de precios por defecto ---
  const priceList = await tx.priceList.create({
    data: { clubId, name: 'General', isDefault: true },
    select: { id: true },
  });

  return { ownerRoleId, sportId: sport.id, priceListId: priceList.id };
}
