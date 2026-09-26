import { Preferences } from './preferences.ts';
import { dailyRules, validateDate, type DailyEntry, type DailyPatch } from './dailyEntries.ts';
import { shiftDate } from '../domain/dates.ts';
import type { SqlConnection } from './migrations';

export const workTimeFields = ['work_start_time', 'work_morning_end_time', 'work_afternoon_start_time',
  'work_end_time', 'work_third_start_time', 'work_third_end_time'] as const;

/** Read-only preparation. UI must confirm replacement, then apply in one CAS patch. */
export async function standardWorkPatch(database: SqlConnection): Promise<DailyPatch> {
  const preferences = new Preferences(database);
  const mapping = [
    ['work_start_time', 'work_standard_start'], ['work_morning_end_time', 'work_standard_morning_end'],
    ['work_afternoon_start_time', 'work_standard_afternoon_start'], ['work_end_time', 'work_standard_end'],
  ] as const;
  return Object.fromEntries(await Promise.all(mapping.map(async ([field, key]) => [field, (await preferences.read(key)).value])));
}

/** Never create yesterday or turn its missing times into deletions in today's entry. */
export async function previousWorkPatch(database: SqlConnection, date: string): Promise<DailyPatch> {
  validateDate(date);
  const previous = await database.getFirstAsync<DailyEntry>('SELECT * FROM daily_entries WHERE entry_date = ?', shiftDate(date, -1));
  const patch: DailyPatch = {};
  if (!previous) return patch;
  for (const key of workTimeFields) {
    const value = previous[key];
    if (value === null || value === undefined) continue;
    if (!dailyRules[key](value)) throw new Error('Horaire précédent invalide. Aucun horaire copié.');
    patch[key] = value;
  }
  return patch;
}
