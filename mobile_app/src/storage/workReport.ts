import { buildWorkReport, type WorkRecord } from '../domain/workReport.ts';
import { validateDate } from './dailyEntries.ts';
import { Preferences } from './preferences.ts';
import type { QueryConnection } from './catalogs';

export async function readWorkReport(database: QueryConnection, date: string) {
  validateDate(date);
  const target = await new Preferences(database).read('work_weekly_target_hours');
  // Read only work columns, in one SQLite snapshot; no creation or derived writes.
  const rows = await database.getAllAsync<WorkRecord>(
    'SELECT entry_date, work_mode, work_duration_minutes FROM daily_entries WHERE entry_date <= ? ORDER BY entry_date', date);
  return buildWorkReport(rows, date, Number(target.value));
}
