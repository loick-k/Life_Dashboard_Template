export type WorkTimes = {
  work_start_time?: string | null; work_morning_end_time?: string | null;
  work_afternoon_start_time?: string | null; work_end_time?: string | null;
  work_third_start_time?: string | null; work_third_end_time?: string | null;
};
export const DAILY_WORK_TARGET_MINUTES = 462;

function duration(start: string, end: string): number {
  const parse = (clock: string) => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(clock)) throw new Error('Horaire invalide');
    return Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
  };
  const difference = parse(end) - parse(start);
  return difference < 0 ? difference + 1440 : difference;
}

/** Null means incomplete/absent, never zero. Partial source fields stay stored. */
export function workDuration(times: WorkTimes): number | null {
  const { work_start_time: start, work_morning_end_time: morning, work_afternoon_start_time: afternoon,
    work_end_time: end, work_third_start_time: thirdStart, work_third_end_time: thirdEnd } = times;
  if (![start, morning, afternoon, end, thirdStart, thirdEnd].some(Boolean)) return null;
  if (start && end && ![morning, afternoon, thirdStart, thirdEnd].some(Boolean)) return duration(start, end);
  const pairs = [[start, morning], [afternoon, end], [thirdStart, thirdEnd]];
  if (pairs.some(([a, b]) => Boolean(a) !== Boolean(b))) return null;
  return pairs.reduce((sum, [a, b]) => sum + (a && b ? duration(a, b) : 0), 0);
}

export function workBalance(minutes: number | null, dayOff = false, target = DAILY_WORK_TARGET_MINUTES): number | null {
  return minutes === null ? null : minutes - (dayOff ? 0 : target);
}
