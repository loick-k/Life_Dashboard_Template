import type { QueryConnection } from './catalogs';
import { readMetricRows } from './weeklyMetrics.ts';
import { Preferences } from './preferences.ts';
import { buildHistoryReport, periodStart, type HistoryPeriod } from '../domain/historyMetrics.ts';
import { validateDate } from './dailyEntries.ts';

export async function readHistoryMetrics(database: QueryConnection, date: string, period: HistoryPeriod) {
  validateDate(date);
  const earliest = period === 'all' ? await database.getFirstAsync<{ first: string | null }>('SELECT min(entry_date) AS first FROM daily_entries WHERE entry_date <= ?', date) : null;
  const start = periodStart(period, date, earliest?.first ?? undefined);
  const [rows, label] = await Promise.all([readMetricRows(database, start, date), new Preferences(database).read('close_relations_label')]);
  const report = buildHistoryReport(rows, date, period, start);
  report.series = report.series.map(item => item.key === 'close_relations_listening_score' ? { ...item, label: String(label.value) } : item);
  return report;
}
