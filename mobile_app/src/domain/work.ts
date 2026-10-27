export type WorkTimes = {
  work_start_time?: string | null; work_morning_end_time?: string | null;
  work_afternoon_start_time?: string | null; work_end_time?: string | null;
  work_third_start_time?: string | null; work_third_end_time?: string | null;
};
export type WorkState = WorkTimes & { work_mode?: string | null; work_duration_minutes?: number | null };
export const workClockFields = ['work_start_time', 'work_morning_end_time', 'work_afternoon_start_time', 'work_end_time', 'work_third_start_time', 'work_third_end_time'] as const;
export function hasWorkClocks(times: WorkTimes): boolean { return workClockFields.some(key => Boolean(times[key])); }
export const DAILY_WORK_TARGET_MINUTES = 462;

function clockMinutes(clock: string): number {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(clock)) throw new Error('Horaire invalide');
  return Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
}

export interface WorkScheduleResult { minutes: number | null; issue: 'incomplete' | 'overlap' | null }
/** Never count overlapping minutes twice. Source fields are retained, including incomplete slots. */
export function inspectWorkSchedule(times: WorkTimes): WorkScheduleResult {
  const { work_start_time: start, work_morning_end_time: morning, work_afternoon_start_time: afternoon,
    work_end_time: end, work_third_start_time: thirdStart, work_third_end_time: thirdEnd } = times;
  if (![start, morning, afternoon, end, thirdStart, thirdEnd].some(Boolean)) return { minutes: null, issue: null };
  const pairs = start && end && !morning && !afternoon
    ? [[start, end], [thirdStart, thirdEnd]]
    : [[start, morning], [afternoon, end], [thirdStart, thirdEnd]];
  if (pairs.some(([a, b]) => Boolean(a) !== Boolean(b))) return { minutes: null, issue: 'incomplete' };
  const pieces: [number, number][] = [];
  let minutes = 0;
  for (const [a, b] of pairs) {
    if (!a || !b) continue;
    const begin = clockMinutes(a), finish = clockMinutes(b);
    minutes += (finish - begin + 1440) % 1440;
    const intervals: [number, number][] = finish < begin ? [[begin, 1440], [0, finish]] : [[begin, finish]];
    for (const interval of intervals) {
      if (pieces.some(([low, high]) => Math.max(low, interval[0]) < Math.min(high, interval[1]))) return { minutes: null, issue: 'overlap' };
      pieces.push(interval);
    }
  }
  return { minutes, issue: null };
}

export function workDuration(times: WorkTimes): number | null { return inspectWorkSchedule(times).minutes; }

/** Reading Day off with no clocks means zero work, not an unknown worked day.
 * Do not store a synthetic zero: switching back to Bureau must reveal the original
 * absence, while a real imported zero/duration remains authoritative in every mode. */
export function effectiveWorkMinutes(row: WorkState): number | null {
  if (inspectWorkSchedule(row).issue === 'overlap') return null;
  const stored = row.work_duration_minutes;
  if (stored !== null && stored !== undefined) {
    if (!Number.isSafeInteger(stored) || stored < 0) throw new Error('Durée de travail invalide.');
    return stored;
  }
  return row.work_mode === 'Day off' && !hasWorkClocks(row) ? 0 : null;
}

export function workBalance(minutes: number | null, dayOff = false, target = DAILY_WORK_TARGET_MINUTES): number | null {
  return minutes === null ? null : minutes - (dayOff ? 0 : target);
}
