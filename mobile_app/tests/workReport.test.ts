import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { buildWorkReport, formatMinutes, type WorkRecord } from '../src/domain/workReport.ts';
import { readWorkReport } from '../src/storage/workReport.ts';
import { migrate, type BindValue } from '../src/storage/migrations.ts';
import type { QueryConnection } from '../src/storage/catalogs.ts';
import { DailyEntries } from '../src/storage/dailyEntries.ts';
import { Preferences } from '../src/storage/preferences.ts';
import { workBalance } from '../src/domain/work.ts';

function adapter(db: DatabaseSync): QueryConnection {
  return {
    execAsync: async sql => { db.exec(sql); },
    getFirstAsync: async <T>(sql: string, ...params: BindValue[]) => (db.prepare(sql).get(...params) as T) ?? null,
    getAllAsync: async <T>(sql: string, ...params: BindValue[]) => db.prepare(sql).all(...params) as T[],
    runAsync: async (sql, ...params) => ({ changes: Number(db.prepare(sql).run(...params).changes) }),
  };
}
const migrations = JSON.parse(readFileSync('src/storage/generated/migrations.json', 'utf8'));
const row = (date: string, minutes: number | null, mode = 'Bureau'): WorkRecord => ({ entry_date: date, work_duration_minutes: minutes, work_mode: mode });

test('V2 work balances match the fixtures independently checked against the V1 Python domain', () => {
  const cases = JSON.parse(readFileSync('tests/fixtures/work_balance.json', 'utf8'));
  for (const item of cases) assert.equal(workBalance(item.minutes, item.day_off), item.balance);
});

test('cumulative counter crosses weeks, excludes future/incomplete and counts zero and Day off correctly', () => {
  const records = [row('2026-09-01', 480), row('2026-09-20', 400), row('2026-09-21', 462),
    row('2026-09-22', null), row('2026-09-23', 60, 'Day off'), row('2026-09-24', 0), row('2026-09-26', 900)];
  const result = buildWorkReport(records, '2026-09-24', 35);
  assert.equal(result.monday, '2026-09-21');
  assert.equal(result.sunday, '2026-09-27');
  assert.equal(result.beforeMinutes, 16);
  assert.equal(result.dayBalance, -462);
  assert.equal(result.afterMinutes, -446);
  assert.equal(result.cumulativeMinutes, -446);
  assert.equal(result.countedDays, 5);
  assert.equal(result.incompleteDays, 1);
  assert.equal(result.weekMinutes, 522);
  assert.equal(result.weekDifference, 522 - 2100);
  assert.equal(result.rows[0]!.cumulative, -44); // Not reset on Monday.
  assert.equal(result.rows[1]!.balance, null);
  assert.equal(buildWorkReport(records, '2026-09-25', 0).weekTargetMinutes, 0);
  const incomplete = buildWorkReport(records, '2026-09-22', 35);
  assert.equal(incomplete.beforeMinutes, -44);
  assert.equal(incomplete.cumulativeMinutes, -44);
  assert.equal(incomplete.afterMinutes, null);
});

test('empty week never displays a missing cumulative counter and dates handle year boundaries', () => {
  const report = buildWorkReport([], '2026-01-01', 35);
  assert.equal(report.monday, '2025-12-29');
  assert.equal(report.sunday, '2026-01-04');
  assert.equal(report.cumulativeMinutes, 0);
  assert.equal(report.weekMinutes, null);
  assert.equal(report.weekDifference, null);
  assert.equal(formatMinutes(0, true), 'À l’équilibre');
  assert.equal(formatMinutes(-125, true), '−2h05');
  assert.equal(formatMinutes(462), '7h42');
  assert.equal(formatMinutes(null), 'n.c.');
  assert.equal(formatMinutes(3010, true), '+50h10');
  assert.throws(() => buildWorkReport([], '2026-02-30', 35));
  assert.throws(() => buildWorkReport([row('2026-01-01', 1.5)], '2026-01-01', 35));
  assert.throws(() => buildWorkReport([row('2026-01-01', 1), row('2026-01-01', 2)], '2026-01-01', 35));
});

test('form and Bilan repository share confirmed history, update after edits and survive reopen without writes', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'life-work-bilan-synthetic-'));
  const path = join(folder, 'test.db');
  let db = new DatabaseSync(path);
  try {
    let sql = adapter(db); await migrate(sql, migrations);
    let repo = new DailyEntries(sql, randomUUID);
    let previous = await repo.getOrCreate('2026-09-18');
    previous = await repo.patch(previous.entry_id, previous.revision, { work_mode: 'Bureau', work_start_time: '08:00', work_end_time: '16:00' });
    let today = await repo.getOrCreate('2026-09-21');
    today = await repo.patch(today.entry_id, today.revision, { work_mode: 'Bureau', work_start_time: '08:17', weight_kg: 73 });
    let report = await readWorkReport(sql, '2026-09-21');
    assert.equal(report.beforeMinutes, 18);
    assert.equal(report.cumulativeMinutes, 18);
    assert.equal(report.afterMinutes, null);
    today = await repo.patch(today.entry_id, today.revision, { work_end_time: '16:00' });
    report = await readWorkReport(sql, '2026-09-21');
    assert.equal(report.cumulativeMinutes, 19);
    assert.equal(report.afterMinutes, 19);
    assert.equal(report.dayMinutes, 463);
    await new Preferences(sql).set('work_weekly_target_hours', 0, 0);
    const before = db.prepare('SELECT total_changes() AS n').get()!.n;
    report = await readWorkReport(sql, '2026-09-21');
    assert.equal(report.weekTargetMinutes, 0);
    assert.equal(report.cumulativeMinutes, 19);
    assert.equal(db.prepare('SELECT total_changes() AS n').get()!.n, before);
    db.close(); db = new DatabaseSync(path); sql = adapter(db);
    assert.deepEqual(await readWorkReport(sql, '2026-09-21'), report);
    repo = new DailyEntries(sql, randomUUID);
    assert.equal((await repo.getOrCreate('2026-09-21')).weight_kg, 73);
    await repo.patch(previous.entry_id, previous.revision, { work_end_time: '15:00' });
    assert.equal((await readWorkReport(sql, '2026-09-21')).cumulativeMinutes, -41);
  } finally { db.close(); rmSync(folder, { recursive: true }); }
});
