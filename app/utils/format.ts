// app/utils/format.ts
// Utilidades de formateo centralizadas.

const mxnFormatter = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })

/** Formatea un número como moneda mexicana (MXN). */
export function formatMoney(amount: number): string {
  return mxnFormatter.format(amount)
}
