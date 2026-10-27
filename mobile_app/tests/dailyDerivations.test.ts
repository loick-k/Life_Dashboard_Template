import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { migrate, type BindValue } from '../src/storage/migrations.ts';
import { DailyEntries } from '../src/storage/dailyEntries.ts';
import { SportSessions } from '../src/storage/sportSessions.ts';
import type { QueryConnection } from '../src/storage/catalogs';
import { sleepDurationHours, sleepDisagrees } from '../src/domain/sleep.ts';
import { nutritionStatus } from '../src/domain/nutrition.ts';
import { weeklySeries } from '../src/domain/weeklyMetrics.ts';
import { readWeeklyMetrics } from '../src/storage/weeklyMetrics.ts';
import { captureSnapshot, restoreSnapshot, backupTables } from '../src/storage/backupSnapshot.ts';

const migrations = JSON.parse(readFileSync('src/storage/generated/migrations.json', 'utf8'));
function fixture() {
  const native = new DatabaseSync(':memory:');
  const sql: QueryConnection = {
    execAsync: async statement => { native.exec(statement); },
    getFirstAsync: async <T>(statement: string, ...params: BindValue[]) => native.prepare(statement).get(...params) as T ?? null,
    getAllAsync: async <T>(statement: string, ...params: BindValue[]) => native.prepare(statement).all(...params) as T[],
    runAsync: async (statement, ...params) => ({ changes: Number(native.prepare(statement).run(...params).changes) }),
  };
  return { native, sql };
}

test('sleep derives across midnight; manual override and imported mismatch stay explicit without touching other fields', async () => {
  const { native, sql } = fixture();
  try {
    await migrate(sql, migrations); const repo = new DailyEntries(sql, randomUUID);
    let day = await repo.getOrCreate('2026-10-26');
    day = await repo.patch(day.entry_id, day.revision, { sleep_bedtime: '23:00', weight_kg: 72.4 });
    assert.equal(day.sleep_hours, null);
    day = await repo.patch(day.entry_id, day.revision, { sleep_wake_time: '07:00', nap_minutes: 30 });
    assert.equal(day.sleep_hours, 8); assert.equal(day.sleep_duration_mode, 'calculated');
    day = await repo.patch(day.entry_id, day.revision, { sleep_hours: 5 });
    assert.equal(day.sleep_duration_mode, 'manual'); assert.equal(sleepDisagrees(day.sleep_hours, day.sleep_bedtime, day.sleep_wake_time), true);
    day = await repo.patch(day.entry_id, day.revision, { sleep_bedtime: '22:00' });
    assert.equal(day.sleep_hours, 5); // Explicit manual choice is never silently replaced.
    day = await repo.patch(day.entry_id, day.revision, { sleep_duration_mode: 'calculated' });
    assert.equal(day.sleep_hours, 9);
    day = await repo.patch(day.entry_id, day.revision, { sleep_wake_time: null });
    assert.equal(day.sleep_hours, null); assert.equal(day.nap_minutes, 30); assert.equal(day.weight_kg, 72.4);
    await assert.rejects(repo.patch(day.entry_id, day.revision, { sleep_duration_mode: 'calculated' }));
    assert.equal(sleepDurationHours('23:55', '00:05'), 1 / 6);
    assert.equal(sleepDurationHours('07:00', '07:00'), 24);
    assert.equal(sleepDurationHours('24:00', '07:00'), null);
  } finally { native.close(); }
});

test('meal/body edits invalidate estimates without destroying values, provenance or unrelated indicators', async () => {
  const { native, sql } = fixture();
  try {
    await migrate(sql, migrations); const repo = new DailyEntries(sql, randomUUID);
    let day = await repo.getOrCreate('2026-10-26');
    native.prepare("UPDATE daily_entries SET kcal = 2500, sport_kcal_burned = 500, nutrition_analysis_hash = 'synthetic-hash', nutrition_estimate_origin = 'v1'").run();
    day = await repo.getOrCreate(day.entry_date); assert.equal(nutritionStatus(day), 'available');
    day = await repo.patch(day.entry_id, day.revision, { meal_dinner: 'Repas synthétique changé' });
    assert.equal(nutritionStatus(day), 'stale'); assert.equal(day.kcal, 2500); assert.equal(day.nutrition_analysis_hash, 'synthetic-hash');
    assert.equal(day.nutrition_estimate_origin, 'v1'); assert.equal(day.nutrition_inputs_revision, 2);
    const version = day.nutrition_inputs_revision;
    day = await repo.patch(day.entry_id, day.revision, { meal_dinner: 'Repas synthétique changé', self_listening_score: 8 });
    assert.equal(day.nutrition_inputs_revision, version);
    const food = (await readWeeklyMetrics(sql, day.entry_date)).find(item => item.key === 'kcal')!;
    assert.equal(food.value, null); assert.equal(food.excludedEstimates, 1);
    assert.equal(weeklySeries([{ entry_date: day.entry_date, kcal: 2500, sport_kcal_burned: 500, nutrition_estimate_stale: 1 }], day.entry_date).find(item => item.key === 'net_kcal')!.value, null);
    day = await repo.patch(day.entry_id, day.revision, { weight_kg: 74 });
    assert.equal(day.nutrition_inputs_revision, 3); assert.equal(day.self_listening_score, 8);
    assert.equal(nutritionStatus({ nutrition_estimate_stale: 1, kcal: null }), 'unavailable');
  } finally { native.close(); }
});

test('sport freshness is atomic, has its own revision, and survives portable restoration exactly', async () => {
  const source = fixture(), target = fixture();
  try {
    await migrate(source.sql, migrations); await migrate(target.sql, migrations);
    const repo = new DailyEntries(source.sql, randomUUID); let day = await repo.getOrCreate('2026-10-26');
    const sports = new SportSessions(source.sql, randomUUID);
    let sport = await sports.getOrCreate(day.entry_id, 1);
    assert.equal((await repo.getOrCreate(day.entry_date)).nutrition_inputs_revision, 1);
    source.native.prepare("UPDATE daily_entries SET kcal = 2000, nutrition_estimate_origin = 'v2'").run();
    sport = await sports.patch(sport.session_id, sport.revision, { duration_minutes: 30 });
    const after = await repo.getOrCreate(day.entry_date);
    assert.equal(after.revision, day.revision); assert.equal(after.nutrition_inputs_revision, 2); assert.equal(after.nutrition_estimate_stale, 1);
    // Parent still accepts a targeted edit with its valid user-field revision.
    day = await repo.patch(day.entry_id, day.revision, { work_start_time: '08:17' });
    assert.equal(day.nutrition_inputs_revision, 2);
    sport = await sports.patch(sport.session_id, sport.revision, { duration_minutes: 30 });
    assert.equal((await repo.getOrCreate(day.entry_date)).nutrition_inputs_revision, 2);
    source.native.prepare('UPDATE daily_entries SET nutrition_estimate_stale = 0').run(); // An analysis corresponding to the captured sources.
    const snapshot = await captureSnapshot(source.sql, migrations);
    await restoreSnapshot(target.sql, JSON.stringify(snapshot), migrations);
    assert.deepEqual((await captureSnapshot(target.sql, migrations)).tables, snapshot.tables);
    assert.equal(nutritionStatus(await new DailyEntries(target.sql, randomUUID).getOrCreate(day.entry_date)), 'available');
    await sports.delete(sport.session_id, sport.revision);
    assert.equal(nutritionStatus(await repo.getOrCreate(day.entry_date)), 'stale');
  } finally { source.native.close(); target.native.close(); }
});

test('pre-005 backup upgrades metadata only; imported historical sleep/calories remain unchanged', async () => {
  const source = fixture(), target = fixture();
  try {
    await migrate(source.sql, migrations.slice(0, 4)); await migrate(target.sql, migrations);
    const repo = new DailyEntries(source.sql, randomUUID); const day = await repo.getOrCreate('2026-08-01');
    source.native.prepare("UPDATE daily_entries SET sleep_bedtime = '23:00', sleep_wake_time = '07:00', sleep_hours = 5, kcal = 2300").run();
    const tables = Object.fromEntries(await Promise.all(backupTables.map(async table => [table, await source.sql.getAllAsync(`SELECT * FROM ${table}`)])));
    const snapshot = { format: 'life-dashboard-snapshot', version: 1, createdAt: new Date().toISOString(), migrations: migrations.slice(0, 4).map((item: {id: string; checksum: string}) => ({ id: item.id, checksum: item.checksum })), tables };
    await restoreSnapshot(target.sql, JSON.stringify(snapshot), migrations);
    const restored = await new DailyEntries(target.sql, randomUUID).getOrCreate(day.entry_date);
    assert.equal(restored.sleep_hours, 5); assert.equal(restored.sleep_duration_mode, 'imported'); assert.equal(restored.kcal, 2300);
    assert.equal(restored.nutrition_estimate_origin, 'legacy'); assert.equal(restored.nutrition_estimate_stale, 0);
    (tables.daily_entries as Record<string, unknown>[])[0]!.nutrition_estimate_stale = 0;
    await assert.rejects(restoreSnapshot(target.sql, JSON.stringify(snapshot), migrations));
  } finally { source.native.close(); target.native.close(); }
});

test('interrupted migration 005 rolls back new columns and triggers, preserves old values, then retries', async () => {
  const { native, sql } = fixture();
  try {
    await migrate(sql, migrations.slice(0, 4));
    native.prepare("INSERT INTO daily_entries (entry_id, entry_date, weight_kg, sleep_hours, created_at, updated_at) VALUES ('synthetic','2026-10-26',72,5,'now','now')").run();
    const interrupted: QueryConnection = { ...sql, runAsync: async (statement, ...params) => {
      if (statement.includes('INSERT INTO schema_migrations') && params[0] === '005_daily_derivations') throw new Error('Synthetic interrupted journal');
      return sql.runAsync(statement, ...params);
    } };
    await assert.rejects(migrate(interrupted, migrations));
    assert.equal(native.prepare('PRAGMA table_info(daily_entries)').all().some(row => row.name === 'sleep_duration_mode'), false);
    assert.equal(native.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND name LIKE 'sport_nutrition_%'").get()!.n, 0);
    assert.equal(native.prepare("SELECT sleep_hours FROM daily_entries WHERE entry_id = 'synthetic'").get()!.sleep_hours, 5);
    await migrate(sql, migrations);
    assert.equal(native.prepare("SELECT sleep_duration_mode FROM daily_entries WHERE entry_id = 'synthetic'").get()!.sleep_duration_mode, 'imported');
  } finally { native.close(); }
});
