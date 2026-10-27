import { validateDate } from '../storage/dailyEntries.ts';
import { shiftDate } from './dates.ts';
import { weeklyMetrics, prepareMetricRow, numericMetric, type MetricDefinition, type MetricRow } from './weeklyMetrics.ts';
import { inspectWorkSchedule, type WorkTimes } from './work.ts';

export const historyPeriods = ['week', 'month', 'year', 'all'] as const;
export type HistoryPeriod = typeof historyPeriods[number];
export const historyLabels: Record<HistoryPeriod, string> = { week: '7 jours', month: '1 mois', year: '1 an', all: 'Depuis le début' };
export const periodDays = { week: 7, month: 30, year: 365 } as const;
export type HistoryPoint = { date: string; end: string; label: string; value: number | null; count: number; future: boolean };
export type HistorySeries = MetricDefinition & { value: number | null; count: number; excludedEstimates: number; points: HistoryPoint[] };
export interface HistoryReport { start: string; end: string; period: HistoryPeriod; grain: 'day' | 'week' | 'month'; series: HistorySeries[]; excludedWorkDates: string[] }
export function periodStart(period: HistoryPeriod, end: string, earliest?: string): string {
  validateDate(end);
  if (!historyPeriods.includes(period)) throw new Error('Période inconnue');
  if (earliest) validateDate(earliest);
  return period === 'all' ? earliest && earliest <= end ? earliest : end : shiftDate(end, 1 - periodDays[period]);
}
function monday(date: string) { return shiftDate(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7)); }
function nextMonth(date: string): string {
  const instant = new Date(`${date}T12:00:00Z`); instant.setUTCMonth(instant.getUTCMonth() + 1);
  return instant.toISOString().slice(0, 10);
}
function aggregate(values: number[], kind: 'sum' | 'mean' | 'latest'): number | null {
  return !values.length ? null : kind === 'latest' ? values.at(-1)! : values.reduce((a, b) => a + b, 0) / (kind === 'mean' ? values.length : 1);
}
export function buildHistoryReport(source: readonly MetricRow[], end: string, period: HistoryPeriod, earliest?: string): HistoryReport {
  const start = periodStart(period, end, earliest ?? [...source].map(row => row.entry_date).sort()[0]);
  const grain = period === 'all' ? 'month' : period === 'year' ? 'week' : 'day';
  const keyOf = (date: string) => grain === 'month' ? date.slice(0, 7) + '-01' : grain === 'week' ? monday(date) : date;
  const rows: MetricRow[] = [], buckets = new Map<string, MetricRow[]>(), seen = new Set<string>(), excludedWorkDates: string[] = [];
  for (const sourceRow of [...source].sort((a, b) => a.entry_date.localeCompare(b.entry_date))) {
    validateDate(sourceRow.entry_date);
    if (sourceRow.entry_date < start || sourceRow.entry_date > end) continue;
    if (seen.has(sourceRow.entry_date)) throw new Error('Journée dupliquée'); seen.add(sourceRow.entry_date);
    const row = prepareMetricRow(sourceRow); rows.push(row);
    if (inspectWorkSchedule(sourceRow as WorkTimes).issue === 'overlap') excludedWorkDates.push(row.entry_date);
    const key = keyOf(row.entry_date), bucket = buckets.get(key) ?? []; bucket.push(row); buckets.set(key, bucket);
  }
  const dates: string[] = [];
  for (let cursor = keyOf(start); cursor <= end;) {
    dates.push(cursor);
    if (cursor === keyOf(end)) break; // Avoid stepping out of the supported ISO year at 9999-12.
    cursor = grain === 'month' ? nextMonth(cursor) : shiftDate(cursor, grain === 'week' ? 7 : 1);
  }
  const series = weeklyMetrics.map(definition => {
    const known = rows.map(row => numericMetric(row[definition.key])).filter(value => value !== null);
    const excludedEstimates = definition.group === 'Alimentation' ? rows.filter(row => row.nutrition_estimate_stale === 1 && row.has_nutrition_estimate === 1).length : 0;
    return { ...definition, value: aggregate(known, definition.aggregate), count: known.length, excludedEstimates,
      points: dates.map(date => {
        const values = (buckets.get(date) ?? []).map(row => numericMetric(row[definition.key])).filter(value => value !== null);
        const last = date === keyOf(end) ? end : grain === 'month' ? shiftDate(nextMonth(date), -1) : grain === 'week' ? shiftDate(date, 6) : date;
        return { date, end: last > end ? end : last, label: grain === 'month' ? `${date.slice(5, 7)}/${date.slice(2, 4)}` : date.slice(5).split('-').reverse().join('/'),
          // V1 body KPIs show latest value, while long-period body curves show observed-day means.
          value: aggregate(values, definition.aggregate === 'latest' ? 'mean' : definition.aggregate), count: values.length, future: false };
      }) };
  });
  return { start, end, period, grain, series, excludedWorkDates };
}
