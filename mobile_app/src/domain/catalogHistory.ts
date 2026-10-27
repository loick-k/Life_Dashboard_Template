import { validateDate } from '../storage/dailyEntries.ts';

/** Python round(binary_float, 1), ties-to-even. Preserve V1's actual float value,
 * not a prematurely rounded multiplication such as Math.round(value * 10). */
export function roundInterval(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 3652425) throw new Error('Intervalle invalide');
  if (value === 0) return 0;
  const data = new DataView(new ArrayBuffer(8)); data.setFloat64(0, value);
  const bits = data.getBigUint64(0), exponent = Number((bits >> 52n) & 2047n);
  let numerator = (exponent ? 1n << 52n : 0n) | (bits & ((1n << 52n) - 1n));
  const power = exponent ? exponent - 1075 : -1074;
  numerator *= 10n; let denominator = 1n;
  if (power >= 0) numerator <<= BigInt(power); else denominator <<= BigInt(-power);
  let quotient = numerator / denominator; const remainder = numerator % denominator;
  if (2n * remainder > denominator || 2n * remainder === denominator && quotient % 2n === 1n) quotient++;
  return Number(quotient) / 10;
}
export function recurrence(first: string | null, last: string | null, count: number, end: string) {
  validateDate(end);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Récurrence invalide');
  if (!count) { if (first !== null || last !== null) throw new Error('Dates de récurrence invalides'); return { daysSince: null, averageInterval: null }; }
  if (!first || !last) throw new Error('Dates de récurrence absentes');
  validateDate(first); validateDate(last);
  if (first > last || last > end || count > 1 && first === last) throw new Error('Ordre de récurrence invalide');
  const days = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
  if (count === 1 && first !== last || count > days(first, last) + 1) throw new Error('Nombre de jours incohérent');
  return { daysSince: days(last, end), averageInterval: count > 1 ? roundInterval(days(first, last) / (count - 1)) : null };
}
