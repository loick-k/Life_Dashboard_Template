import type { QueryConnection } from './catalogs';
import { readMetricRows } from './weeklyMetrics.ts';
import { Preferences } from './preferences.ts';
import { shiftDate } from '../domain/dates.ts';
import { buildWeeklyAssessment } from '../domain/weeklyAssessment.ts';
import { validateDate } from './dailyEntries.ts';

export async function readWeeklyAssessment(database: QueryConnection, date: string) {
  validateDate(date);
  const monday = shiftDate(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7));
  const [rows, settings] = await Promise.all([readMetricRows(database, monday, date, true), new Preferences(database).readAll()]);
  return buildWeeklyAssessment(rows, date, Object.fromEntries(Object.entries(settings).map(([key, state]) => [key, state.value])));
}
