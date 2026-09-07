/**
 * Formateo de fecha/hora para los mensajes, en español y en la zona horaria
 * del club. Usa Intl (nativo), sin dependencias.
 *
 * Ej: formatBookingDate → "sáb 2 de agosto", formatBookingTime → "19:00".
 */

export function formatBookingDate(date: Date, timeZone: string): string {
  const s = new Intl.DateTimeFormat('es-AR', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    timeZone,
  }).format(date);
  // "sáb., 2 de agosto" → "sáb 2 de agosto"
  return s.replace(/\.?,/, '').replace(/\.\s/, ' ');
}

export function formatBookingTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(date);
}

/** Monto en pesos para los mensajes de pago. Ej: "$ 12.500,00". */
export function formatMoney(amount: number, currency = 'ARS'): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency,
  }).format(amount);
}
