import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { migrate, type BindValue } from '../src/storage/migrations.ts';
import { Catalogs, type QueryConnection } from '../src/storage/catalogs.ts';
import { DailyEntries } from '../src/storage/dailyEntries.ts';
import { SportSessions } from '../src/storage/sportSessions.ts';
import { readRelatedSummary } from '../src/storage/dailySummary.ts';
import { readWeeklyMetrics } from '../src/storage/weeklyMetrics.ts';
import { readWorkReport } from '../src/storage/workReport.ts';
import { inspectWorkSchedule, workDuration } from '../src/domain/work.ts';
import { parseSportDuration } from '../src/domain/sportInput.ts';

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

test('uncheck/recheck goal preserves identity, note and timestamps with stale revisions refused', async () => {
  const { native, sql } = fixture();
  try {
    await migrate(sql, migrations);
    const day = await new DailyEntries(sql, randomUUID).getOrCreate('2026-10-26');
    const goals = new Catalogs(sql, randomUUID, 'goals');
    const id = await goals.create('Objectif synthétique'), log = await goals.select(day.entry_id, id);
    native.prepare('UPDATE goal_logs SET note = ? WHERE goal_log_id = ?').run('Note synthétique importée', log.id);
    const createdAt = native.prepare('SELECT created_at FROM goal_logs WHERE goal_log_id = ?').get(log.id)!.created_at;
    await goals.deselect(log);
    assert.equal((await goals.logs(day.entry_id))[0]!.worked, 0);
    await assert.rejects(goals.deselect(log));
    const selected = await goals.select(day.entry_id, id);
    assert.equal(selected.id, log.id);
    const saved = native.prepare('SELECT * FROM goal_logs WHERE goal_log_id = ?').get(log.id)!;
    assert.equal(saved.note, 'Note synthétique importée'); assert.equal(saved.worked, 1); assert.equal(saved.created_at, createdAt);
    assert.equal(saved.revision, 3);
  } finally { native.close(); }
});

test('complete removal of one sports slot leaves other sessions and daily indicators unchanged', async () => {
  const { native, sql } = fixture();
  try {
    await migrate(sql, migrations);
    const daily = new DailyEntries(sql, randomUUID); let day = await daily.getOrCreate('2026-10-26');
    day = await daily.patch(day.entry_id, day.revision, { weight_kg: 72.4 });
    const sports = new SportSessions(sql, randomUUID);
    const a = await sports.getOrCreate(day.entry_id, 1), b = await sports.getOrCreate(day.entry_id, 2);
    const first = await sports.patch(a.session_id, a.revision, { sport_type: 'Course', duration_minutes: 30, distance_km: 5 });
    const second = await sports.patch(b.session_id, b.revision, { sport_type: 'Vélo', distance_km: 20 });
    await sports.patch(first.session_id, first.revision, { sport_type: null, duration_minutes: null, distance_km: null });
    const summary = await readRelatedSummary(sql, day.entry_id);
    assert.equal(summary.sports.length, 1); assert.equal(summary.sports[0]!.session_id, second.session_id);
    const series = await readWeeklyMetrics(sql, day.entry_date);
    assert.equal(series.find(item => item.key === 'sport_count')!.value, 1);
    assert.equal(series.find(item => item.key === 'sport_partial_count')!.value, 1);
    assert.equal((await daily.getOrCreate(day.entry_date)).weight_kg, 72.4);
  } finally { native.close(); }
});

test('sports duration pair recovers after invalid companion and distinguishes missing from zero', () => {
  assert.equal(parseSportDuration('11', '30').valid, false);
  assert.deepEqual(parseSportDuration('1', '30'), { valid: true, minutes: 90 });
  assert.equal(parseSportDuration('1.', '30').valid, false);
  assert.equal(parseSportDuration('', '').valid, false);
  assert.deepEqual(parseSportDuration('0', ''), { valid: true, minutes: 0 });
  assert.equal(parseSportDuration('1', '60').valid, false);
  assert.equal(parseSportDuration('10', '1').valid, false);
});

test('work validates overlaps across midnight, adjacent slots and continuous day with third slot', () => {
  assert.equal(workDuration({ work_start_time: '08:00', work_end_time: '16:00', work_third_start_time: '18:00', work_third_end_time: '19:00' }), 540);
  assert.equal(workDuration({ work_start_time: '08:00', work_end_time: '16:00', work_third_start_time: '18:00' }), null);
  assert.equal(inspectWorkSchedule({ work_start_time: '09:00', work_morning_end_time: '12:00', work_afternoon_start_time: '11:00', work_end_time: '17:00' }).issue, 'overlap');
  assert.equal(workDuration({ work_start_time: '09:00', work_morning_end_time: '12:00', work_afternoon_start_time: '12:00', work_end_time: '17:00' }), 480);
  assert.equal(inspectWorkSchedule({ work_start_time: '23:00', work_end_time: '02:00', work_third_start_time: '01:00', work_third_end_time: '03:00' }).issue, 'overlap');
  assert.equal(workDuration({ work_start_time: '23:00', work_end_time: '01:00', work_third_start_time: '01:00', work_third_end_time: '02:00' }), 180);
});

test('old overlapping records are visibly excluded from both counters without overwriting original duration', async () => {
  const { native, sql } = fixture();
  try {
    await migrate(sql, migrations);
    const repo = new DailyEntries(sql, randomUUID); let day = await repo.getOrCreate('2026-10-26');
    day = await repo.patch(day.entry_id, day.revision, { work_mode: 'Bureau', work_start_time: '09:00', work_morning_end_time: '12:00', work_afternoon_start_time: '11:00', work_end_time: '17:00' });
    assert.equal(day.work_duration_minutes, null);
    native.prepare('UPDATE daily_entries SET work_duration_minutes = 540 WHERE entry_id = ?').run(day.entry_id);
    const report = await readWorkReport(sql, day.entry_date);
    assert.deepEqual(report.invalidSchedules, [day.entry_date]); assert.equal(report.dayMinutes, null); assert.equal(report.cumulativeMinutes, 0);
    assert.equal(native.prepare('SELECT work_duration_minutes FROM daily_entries WHERE entry_id = ?').get(day.entry_id)!.work_duration_minutes, 540);
    day = await repo.patch(day.entry_id, day.revision, { work_afternoon_start_time: '12:00' });
    assert.equal(day.work_duration_minutes, 480);
    assert.equal((await readWorkReport(sql, day.entry_date)).cumulativeMinutes, 18);
  } finally { native.close(); }
});
