export type InputKind = 'number' | 'time' | 'text';
export function parseInput(raw: string, kind: InputKind): string | number | undefined {
  if (kind === 'text') return raw;
  const value = raw.trim();
  if (!value) return undefined; // Empty editing buffer is NOT an explicit deletion.
  if (kind === 'time') return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : undefined;
  if (!/^\d+(?:[.,]\d+)?$/.test(value)) return undefined;
  const number = Number(value.replace(',', '.'));
  return Number.isFinite(number) ? number : undefined;
}
