import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { buildHistoryReport, periodStart, type HistoryReport } from '../src/domain/historyMetrics.ts';
import { readHistoryMetrics } from '../src/storage/historyMetrics.ts';
import { readWorkReport } from '../src/storage/workReport.ts';
import { DailyEntries } from '../src/storage/dailyEntries.ts';
import { Catalogs, type QueryConnection } from '../src/storage/catalogs.ts';
import { SportSessions } from '../src/storage/sportSessions.ts';
import { migrate, type BindValue } from '../src/storage/migrations.ts';
import { shiftDate } from '../src/domain/dates.ts';
import type { MetricRow } from '../src/domain/weeklyMetrics.ts';

const { harness, press, label, button } = createRequire(import.meta.url)('./helpers/reactHarness.cjs');
const migrations = JSON.parse(readFileSync('src/storage/generated/migrations.json', 'utf8'));
const shared = JSON.parse(readFileSync('tests/fixtures/history_metrics.json', 'utf8'));
const series = (report: HistoryReport, key: string) => report.series.find(item => item.key === key)!;
async function fixture() {
  const native = new DatabaseSync(':memory:');
  const sql: QueryConnection = {
    execAsync: async statement => { native.exec(statement); },
    getFirstAsync: async <T>(statement: string, ...params: BindValue[]) => native.prepare(statement).get(...params) as T ?? null,
    getAllAsync: async <T>(statement: string, ...params: BindValue[]) => native.prepare(statement).all(...params) as T[],
    runAsync: async (statement, ...params) => ({ changes: Number(native.prepare(statement).run(...params).changes) }),
  };
  await migrate(sql, migrations); return { native, sql };
}

test('rolling V1 windows, leap-year/DST/month boundaries and all-history are exact', () => {
  for (const row of shared.periods) assert.equal(periodStart(row.period, row.end), row.start);
  const monthly = buildHistoryReport(shared.rows, '2026-03-01', 'all');
  for (const [key, expected] of Object.entries(shared.monthly)) assert.deepEqual(series(monthly, key).points.map(point => point.value), expected);
  assert.equal(periodStart('week', '2026-10-27'), '2026-10-21');
  assert.equal(periodStart('month', '2024-03-01'), '2024-02-01');
  assert.equal(periodStart('year', '2024-03-01'), '2023-03-03');
  assert.equal(periodStart('all', '2026-10-27', '2020-01-01'), '2020-01-01');
  const annual = buildHistoryReport([], '2026-10-27', 'year');
  assert.ok(series(annual, 'weight_kg').points.length >= 52);
  assert.ok(series(annual, 'weight_kg').points.every(point => new Date(`${point.date}T12:00:00Z`).getUTCDay() === 1));
  assert.equal(buildHistoryReport([], '9999-12-31', 'all').series[0]!.points.length, 1);
  assert.ok(buildHistoryReport([], '2026-03-30', 'week').series.every(item => item.points.length === 7));
  assert.throws(() => buildHistoryReport([], '2026-02-30', 'month'));
});

test('bucket means and full-period KPIs use actual observed days, never means of means; calorie pairs stay daily', () => {
  const report = buildHistoryReport([
    { entry_date: '2026-01-01', sleep_hours: 6, weight_kg: 70, kcal: 2000, alcohol_glasses: 0, me_time_writing_minutes: 0, work_duration_minutes: 462 },
    { entry_date: '2026-01-02', sleep_hours: 8, weight_kg: 72, sport_kcal_burned: 500, alcohol_glasses: 2, me_time_outings_minutes: 90 },
    { entry_date: '2026-01-08', sleep_hours: 12, weight_kg: 74, kcal: 1800, sport_kcal_burned: 300, alcohol_glasses: 1, work_duration_minutes: 522 },
  ], '2026-01-08', 'year');
  assert.equal(series(report, 'sleep_hours').value, 26 / 3); assert.equal(series(report, 'sleep_hours').count, 3);
  assert.deepEqual(series(report, 'sleep_hours').points.filter(point => point.count).map(point => point.value), [7, 12]);
  assert.equal(series(report, 'weight_kg').value, 74);
  assert.deepEqual(series(report, 'weight_kg').points.filter(point => point.count).map(point => point.value), [71, 74]);
  assert.equal(series(report, 'net_kcal').value, 1500); assert.equal(series(report, 'net_kcal').count, 1);
  assert.equal(series(report, 'alcohol_glasses').value, 3); assert.equal(series(report, 'me_time_total').value, 90);
  assert.equal(series(report, 'work_duration_minutes').value, 984); assert.equal(series(report, 'work_balance_minutes').value, 60);
});

test('month gaps remain gaps, zero remains zero, stale estimates and overlapping work are excluded without mutating sources', () => {
  const rows: MetricRow[] = [
    { entry_date: '2026-01-31', body_fat_pct: 0, alcohol_glasses: 0 },
    { entry_date: '2026-03-01', body_fat_pct: 20, kcal: 2000, nutrition_estimate_stale: 1, work_duration_minutes: 600,
      work_start_time: '09:00', work_morning_end_time: '12:00', work_afternoon_start_time: '11:00', work_end_time: '18:00' },
    { entry_date: '2026-03-02', alcohol_glasses: 100 },
  ];
  const before = JSON.stringify(rows), report = buildHistoryReport(rows, '2026-03-01', 'all');
  assert.deepEqual(series(report, 'body_fat_pct').points.map(point => point.value), [0, null, 20]);
  assert.equal(series(report, 'alcohol_glasses').value, 0); assert.equal(series(report, 'kcal').value, null);
  assert.equal(series(report, 'kcal').excludedEstimates, 1); assert.equal(series(report, 'work_duration_minutes').value, null);
  assert.deepEqual(report.excludedWorkDates, ['2026-03-01']); assert.equal(JSON.stringify(rows), before);
});

test('SQLite history has no relation multiplication or writes; blank categories are not invented zeros and cumulative work remains global', async () => {
  const { native, sql } = await fixture();
  try {
    const repo = new DailyEntries(sql, randomUUID);
    const old = await repo.getOrCreate('2025-01-01'); await repo.patch(old.entry_id, old.revision, { work_mode: 'Bureau', work_start_time: '08:00', work_end_time: '16:42' });
    const day = await repo.getOrCreate('2026-10-26');
    await repo.patch(day.entry_id, day.revision, { weight_kg: 70, body_fat_pct: 0, meal_lunch: 'x'.repeat(10000) });
    assert.equal(series(await readHistoryMetrics(sql, '2026-10-27', 'week'), 'social_count').value, null);
    const sports = new SportSessions(sql, randomUUID);
    for (const position of [1, 2]) { const row = await sports.getOrCreate(day.entry_id, position); await sports.patch(row.session_id, row.revision, { duration_minutes: 30 }); }
    const people = new Catalogs(sql, randomUUID, 'friends');
    for (const name of ['A', 'B']) await people.select(day.entry_id, await people.create('Personne fictive ' + name));
    const before = native.prepare('SELECT total_changes() AS n').get()!.n;
    const month = await readHistoryMetrics(sql, '2026-10-27', 'month');
    assert.equal(series(month, 'sport_minutes').value, 60); assert.equal(series(month, 'social_count').value, 2);
    assert.equal(series(month, 'body_fat_pct').value, 0); assert.equal(series(month, 'work_duration_minutes').value, null);
    let fetchedMealText = false;
    const lean = { ...sql, getAllAsync: async <T>(statement: string, ...params: BindValue[]) => {
      if (statement.includes('d.meal_lunch')) fetchedMealText = true;
      return sql.getAllAsync<T>(statement, ...params);
    } };
    const all = await readHistoryMetrics(lean, '2026-10-27', 'all'); assert.equal(all.start, '2025-01-01');
    assert.equal(fetchedMealText, false); // Long history never loads free-form meal descriptions into chart data.
    assert.equal(series(all, 'work_balance_minutes').value, 60);
    assert.equal((await readWorkReport(sql, '2026-10-27')).cumulativeMinutes, 60);
    assert.equal(native.prepare('SELECT total_changes() AS n').get()!.n, before);
  } finally { native.close(); }
});

test('history UI switches all four periods, pages older chart points without truncating KPIs and keeps selected category', async () => {
  const { native, sql } = await fixture(); const h = harness(sql); let tree: any, requested = '';
  try {
    const repo = new DailyEntries(sql, randomUUID);
    for (const [date, value] of [['2023-01-01', 80], ['2026-10-26', 70]] as const) { const day = await repo.getOrCreate(date); await repo.patch(day.entry_id, day.revision, { weight_kg: value, sleep_hours: 8 }); }
    const { HistoryIndicators } = h.load('ui/HistoryIndicators.tsx');
    await h.act(async () => { tree = h.create(h.React.createElement(HistoryIndicators, { database: sql, date: '2026-10-27', onDate(date: string) { requested = date; } })); });
    assert.equal(button(tree, '1 mois').props.accessibilityState.selected, true);
    assert.match(label(tree.root), /70 kg/);
    await press(h, tree, 'Depuis le début'); assert.match(label(tree.root), /sur 46/);
    await press(h, tree, '← Points plus anciens'); assert.match(label(tree.root), /points 1–22 sur 46/);
    assert.match(label(tree.root), /70 kg/); // KPI is still the full history, not the displayed older slice.
    await press(h, tree, 'Sommeil'); await press(h, tree, '1 an');
    assert.equal(button(tree, 'Sommeil').props.accessibilityState.selected, true);
    assert.match(label(tree.root), /par semaine \(lundi–dimanche\)/);
    await press(h, tree, '7 jours'); assert.match(label(tree.root), /21\/10\/2026/);
    await press(h, tree, '← Période précédente'); assert.equal(requested, '2026-10-20');
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('late older period read cannot replace the newer selection; history failure retries without resetting period', async () => {
  const { native, sql } = await fixture(); let tree: any, fail = false, release!: () => void, firstRead = true;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const port = { ...sql, getAllAsync: async <T>(statement: string, ...params: BindValue[]) => {
    if (firstRead) { firstRead = false; await gate; }
    if (fail) throw new Error('Synthetic read failure');
    return sql.getAllAsync<T>(statement, ...params);
  } }; const h = harness(port);
  try {
    const { HistoryIndicators } = h.load('ui/HistoryIndicators.tsx');
    await h.act(async () => { tree = h.create(h.React.createElement(HistoryIndicators, { database: port, date: '2026-10-27' })); });
    await press(h, tree, '1 an'); assert.match(label(tree.root), /par semaine/);
    await h.act(async () => release()); assert.match(label(tree.root), /par semaine/);
    fail = true; await press(h, tree, 'Depuis le début'); assert.match(label(tree.root), /Historique indisponible/);
    fail = false; await press(h, tree, 'Réessayer l’historique');
    assert.equal(button(tree, 'Depuis le début').props.accessibilityState.selected, true); assert.match(label(tree.root), /par mois/);
  } finally { release(); if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('ten years of synthetic history keeps full totals while exposing monthly buckets and all 29 metrics', () => {
  const rows = Array.from({ length: 3650 }, (_, index) => ({ entry_date: shiftDate('2016-10-30', index), phone_minutes: index % 2 ? 120 : 0, sport_minutes: 30 }));
  const report = buildHistoryReport(rows, rows.at(-1)!.entry_date, 'all');
  assert.equal(report.series.length, 29); assert.equal(series(report, 'phone_minutes').value, 60);
  assert.equal(series(report, 'sport_minutes').value, 3650 * 30); assert.equal(series(report, 'sport_minutes').count, 3650);
  assert.ok(report.series.every(item => item.points.length > 100 && item.points.length < 125));
});
