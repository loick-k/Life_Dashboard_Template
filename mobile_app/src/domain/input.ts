export type InputKind = 'number' | 'time' | 'text';
export function normalizeClock(raw: string): string | undefined {
  const value = raw.trim();
  const match = /^(\d{1,2})[:hH](\d{2})$/.exec(value) ?? /^(\d{2})(\d{2})$/.exec(value);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return undefined;
  return `${match[1]!.padStart(2, '0')}:${match[2]}`;
}
export function parseInput(raw: string, kind: InputKind): string | number | undefined {
  if (kind === 'text') return raw;
  const value = raw.trim();
  if (!value) return undefined; // Empty editing buffer is NOT an explicit deletion.
  if (kind === 'time') return normalizeClock(value);
  if (!/^\d+(?:[.,]\d+)?$/.test(value)) return undefined;
  const number = Number(value.replace(',', '.'));
  return Number.isFinite(number) ? number : undefined;
}
