import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { weeklySeries, type MetricSeries } from '../src/domain/weeklyMetrics.ts';
import { readWeeklyMetrics } from '../src/storage/weeklyMetrics.ts';
import { DailyEntries } from '../src/storage/dailyEntries.ts';
import { SportSessions } from '../src/storage/sportSessions.ts';
import { Catalogs, type QueryConnection } from '../src/storage/catalogs.ts';
import { Preferences } from '../src/storage/preferences.ts';
import { migrate, type BindValue } from '../src/storage/migrations.ts';

const metric = (series: MetricSeries[], key: string) => series.find(item => item.key === key)!;
function adapter(db: DatabaseSync): QueryConnection {
  return {
    execAsync: async sql => { db.exec(sql); },
    getFirstAsync: async <T>(sql: string, ...params: BindValue[]) => (db.prepare(sql).get(...params) as T) ?? null,
    getAllAsync: async <T>(sql: string, ...params: BindValue[]) => db.prepare(sql).all(...params) as T[],
    runAsync: async (sql, ...params) => ({ changes: Number(db.prepare(sql).run(...params).changes) }),
  };
}
const migrations = JSON.parse(readFileSync('src/storage/generated/migrations.json', 'utf8'));

test('weekly metrics distinguish absent, zero, partial sums and paired calorie estimates', () => {
  const series = weeklySeries([
    { entry_date: '2026-09-20', sleep_hours: 24 }, // Outside week.
    { entry_date: '2026-09-21', sleep_hours: 8, alcohol_glasses: 0, weight_kg: 74, kcal: 1200, sport_kcal_burned: 1400, me_time_writing_minutes: 0 },
    { entry_date: '2026-09-22', sleep_hours: null, kcal: 1000, sport_kcal_burned: null, weight_kg: null },
    { entry_date: '2026-09-23', sleep_hours: 0, weight_kg: 73.2, me_time_outings_minutes: 25 },
    { entry_date: '2026-09-24', sleep_hours: 24, weight_kg: 99 }, // Future relative to reference.
  ], '2026-09-23');
  assert.equal(series.length, 29);
  assert.equal(metric(series, 'sleep_hours').value, 4);
  assert.equal(metric(series, 'sleep_hours').count, 2);
  assert.equal(metric(series, 'alcohol_glasses').value, 0);
  assert.equal(metric(series, 'nap_minutes').value, null);
  assert.equal(metric(series, 'weight_kg').value, 73.2);
  assert.equal(metric(series, 'kcal').value, 1100);
  assert.equal(metric(series, 'net_kcal').value, -200);
  assert.equal(metric(series, 'net_kcal').count, 1);
  assert.equal(metric(series, 'me_time_total').value, 25);
  assert.equal(metric(series, 'me_time_total').count, 2);
  assert.deepEqual(metric(series, 'sleep_hours').points.map(point => point.value), [8, null, 0, null, null, null, null]);
  assert.equal(metric(series, 'sleep_hours').points[3]!.future, true);
});

test('empty history, duplicate rows and invalid values are explicit rather than invented', () => {
  assert.ok(weeklySeries([], '2026-01-01').every(item => item.value === null && item.count === 0));
  assert.equal(weeklySeries([], '2026-01-01')[0]!.points[0]!.date, '2025-12-29');
  assert.throws(() => weeklySeries([], '2026-02-30'));
  assert.throws(() => weeklySeries([{ entry_date: '2026-09-21', sleep_hours: '—' }], '2026-09-21'));
  assert.throws(() => weeklySeries([{ entry_date: '2026-09-21' }, { entry_date: '2026-09-21' }], '2026-09-21'));
});

test('SQLite aggregates each relation once, excludes empty sports and preserves archives/reopen', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'life-weekly-synthetic-'));
  const path = join(folder, 'test.db');
  let db = new DatabaseSync(path);
  try {
    let sql = adapter(db); await migrate(sql, migrations);
    const daily = new DailyEntries(sql, randomUUID);
    let day = await daily.getOrCreate('2026-09-21');
    day = await daily.patch(day.entry_id, day.revision, { weight_kg: 75, phone_minutes: 0 });
    const sports = new SportSessions(sql, randomUUID);
    const one = await sports.getOrCreate(day.entry_id, 1);
    await sports.patch(one.session_id, one.revision, { duration_minutes: 61, distance_km: 8.2 });
    const two = await sports.getOrCreate(day.entry_id, 2);
    await sports.patch(two.session_id, two.revision, { distance_km: 0 });
    await sports.getOrCreate(day.entry_id, 3); // UI placeholder, not a session.
    const people = new Catalogs(sql, randomUUID, 'friends');
    for (const name of ['A', 'B']) {
      const id = await people.create(`Personne fictive ${name}`, 'Ami');
      await people.select(day.entry_id, id);
    }
    await people.setActive((await people.list())[0]!, false);
    const goals = new Catalogs(sql, randomUUID, 'goals');
    for (const name of ['A', 'B', 'C']) await goals.select(day.entry_id, await goals.create(`Objectif fictif ${name}`));
    await goals.setActive((await goals.list())[0]!, false);
    await new Preferences(sql).set('close_relations_label', 0, 'Écoute des proches synthétiques');
    const before = db.prepare('SELECT total_changes() AS n').get()!.n;
    const series = await readWeeklyMetrics(sql, '2026-09-23');
    assert.equal(db.prepare('SELECT total_changes() AS n').get()!.n, before);
    assert.equal(metric(series, 'sport_minutes').value, 61);
    assert.equal(metric(series, 'sport_distance_km').value, 8.2);
    assert.equal(metric(series, 'sport_count').value, 2);
    assert.equal(metric(series, 'sport_partial_count').value, 1);
    assert.equal(metric(series, 'social_count').value, 2);
    assert.equal(metric(series, 'social_minutes').value, null);
    assert.equal(metric(series, 'goals_worked').value, 3);
    assert.equal(metric(series, 'phone_minutes').value, 0);
    assert.equal(metric(series, 'close_relations_listening_score').label, 'Écoute des proches synthétiques');
    db.close(); db = new DatabaseSync(path); sql = adapter(db);
    assert.deepEqual(await readWeeklyMetrics(sql, '2026-09-23'), series);
    assert.ok((await readWeeklyMetrics(sql, '2026-09-14')).every(item => item.value === null));
  } finally { db.close(); rmSync(folder, { recursive: true }); }
});
