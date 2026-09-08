/**
 * Escapa una celda para CSV (RFC 4180): comillas dobles si el valor tiene
 * coma, comilla o salto de línea, duplicando las comillas internas.
 */
export function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
