export type SleepMode = 'calculated' | 'manual' | 'imported';
export function sleepDurationHours(bedtime: unknown, wakeTime: unknown): number | null {
  const clock = (value: unknown): number | null => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
    ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : null;
  const start = clock(bedtime), end = clock(wakeTime);
  if (start === null || end === null) return null;
  // Same clock means the following day, as in the V1 sleep rule.
  return ((end - start + 1439) % 1440 + 1) / 60;
}
export function sleepDisagrees(hours: unknown, bedtime: unknown, wakeTime: unknown): boolean {
  const calculated = sleepDurationHours(bedtime, wakeTime);
  return typeof hours === 'number' && calculated !== null && Math.abs(hours - calculated) > 1 / 120;
}
