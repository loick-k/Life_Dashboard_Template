import type { CatalogKind, QueryConnection } from './catalogs';
import { validateDate } from './dailyEntries.ts';
import { periodStart, type HistoryPeriod } from '../domain/historyMetrics.ts';
import { recurrence } from '../domain/catalogHistory.ts';

export const catalogPageSize = 20;
const definitions = {
  friends: { table: 'friends', id: 'friend_id', label: 'name', logs: 'social_logs', logId: 'social_log_id', counted: 'included' },
  goals: { table: 'goals', id: 'goal_id', label: 'title', logs: 'goal_logs', logId: 'goal_log_id', counted: 'worked' },
} as const;
export interface CatalogStatistic {
  id: string; label: string; category: string | null; active: number; created_at: string; completed_at: string | null;
  count: number; tracked_days: number; first_date: string | null; last_date: string | null;
  daysSince: number | null; averageInterval: number | null;
}
export interface JournalHistoryRow {
  id: string; subject_id: string; entry_date: string; label: string; category: string | null; active: number;
  counted: number; note: string | null; context: string | null; duration_minutes: number | null;
}
export interface SocialPeriod { date: string; days: number; interactions: number }
export interface CatalogHistoryReport {
  start: string; end: string; statistics: CatalogStatistic[]; statisticsMore: boolean;
  logs: JournalHistoryRow[]; logsMore: boolean; periods: SocialPeriod[];
}
export async function readCatalogHistory(db: QueryConnection, kind: CatalogKind, end: string, period: HistoryPeriod, options: { statisticsPage?: number; logsPage?: number; subject?: string; includeUncounted?: boolean; grain?: 'week' | 'month' } = {}): Promise<CatalogHistoryReport> {
  validateDate(end);
  if (!Object.hasOwn(definitions, kind)) throw new Error('Répertoire inconnu');
  const statsPage = options.statisticsPage ?? 0, logsPage = options.logsPage ?? 0, grain = options.grain ?? 'week';
  if (![statsPage, logsPage].every(page => Number.isSafeInteger(page) && page >= 0 && page <= 1000000) || !['week', 'month'].includes(grain)) throw new Error('Pagination invalide');
  const def = definitions[kind];
  const earliest = period === 'all' ? await db.getFirstAsync<{ first: string | null }>(`SELECT min(d.entry_date) AS first FROM ${def.logs} l JOIN daily_entries d ON d.entry_id=l.entry_id WHERE d.entry_date <= ?`, end) : null;
  const start = periodStart(period, end, earliest?.first ?? undefined);
  const [statistics, history, periods] = await Promise.all([
    db.getAllAsync<Omit<CatalogStatistic, 'daysSince' | 'averageInterval'>>(`SELECT s.${def.id} AS id, s.${def.label} AS label,
      ${kind === 'friends' ? 's.category' : 'NULL'} AS category, s.active, s.created_at, ${kind === 'goals' ? 's.completed_at' : 'NULL'} AS completed_at,
      count(DISTINCT CASE WHEN l.${def.counted}=1 THEN d.entry_date END) AS count,
      count(DISTINCT d.entry_date) AS tracked_days,
      min(CASE WHEN l.${def.counted}=1 THEN d.entry_date END) AS first_date,
      max(CASE WHEN l.${def.counted}=1 THEN d.entry_date END) AS last_date
      FROM ${def.table} s LEFT JOIN ${def.logs} l ON l.${def.id}=s.${def.id} AND l.entry_id IN
      (SELECT entry_id FROM daily_entries WHERE entry_date >= ? AND entry_date <= ?)
      LEFT JOIN daily_entries d ON d.entry_id=l.entry_id
      GROUP BY s.${def.id} ORDER BY last_date IS NULL, last_date DESC, count DESC, s.${def.label} COLLATE NOCASE, s.${def.id}
      LIMIT ? OFFSET ?`, start, end, catalogPageSize + 1, statsPage * catalogPageSize),
    db.getAllAsync<JournalHistoryRow>(`SELECT l.${def.logId} AS id, s.${def.id} AS subject_id, d.entry_date, s.${def.label} AS label,
      ${kind === 'friends' ? 's.category' : 'NULL'} AS category, s.active, l.${def.counted} AS counted, l.note,
      ${kind === 'friends' ? 'l.context, l.duration_minutes' : 'NULL AS context, NULL AS duration_minutes'}
      FROM ${def.logs} l JOIN ${def.table} s ON s.${def.id}=l.${def.id} JOIN daily_entries d ON d.entry_id=l.entry_id
      WHERE d.entry_date >= ? AND d.entry_date <= ? ${options.includeUncounted ?? kind === 'goals' ? '' : `AND l.${def.counted}=1`}
      ${options.subject ? `AND s.${def.id}=?` : ''} ORDER BY d.entry_date DESC, s.${def.label} COLLATE NOCASE, l.${def.logId}
      LIMIT ? OFFSET ?`, start, end, ...(options.subject ? [options.subject] : []), catalogPageSize + 1, logsPage * catalogPageSize),
    kind === 'friends' ? db.getAllAsync<SocialPeriod>(`SELECT ${grain === 'month' ? "substr(d.entry_date,1,7)||'-01'" : "date(d.entry_date, printf('-%d days', (CAST(strftime('%w',d.entry_date) AS INTEGER)+6)%7))"} AS date,
      count(DISTINCT d.entry_date) AS days, count(*) AS interactions
      FROM social_logs l JOIN daily_entries d ON d.entry_id=l.entry_id
      WHERE l.included=1 AND d.entry_date >= ? AND d.entry_date <= ? GROUP BY date ORDER BY date`, start, end) : Promise.resolve([]),
  ]);
  return { start, end, statistics: statistics.slice(0, catalogPageSize).map(row => ({ ...row, ...recurrence(row.first_date, row.last_date, row.count, end) })),
    statisticsMore: statistics.length > catalogPageSize, logs: history.slice(0, catalogPageSize), logsMore: history.length > catalogPageSize, periods };
}
