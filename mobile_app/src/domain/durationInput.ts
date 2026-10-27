/** Missing and unfinished input is not an instruction to erase a stored duration. */
export function durationFromParts(hours: string, minutes: string): number | undefined {
  const h = hours.trim(), m = minutes.trim();
  if ((!h && !m) || (h && !/^\d+$/.test(h)) || (m && !/^\d+$/.test(m))) return undefined;
  const hour = Number(h || 0), minute = Number(m || 0), total = hour * 60 + minute;
  return minute <= 59 && Number.isSafeInteger(total) ? total : undefined;
}
export function sumKnownMinutes(values: readonly unknown[]): number | null {
  const known = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
}
