import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { effectiveWorkMinutes } from '../src/domain/work.ts';
import { scoreWork } from '../src/domain/assessmentScores.ts';
import { DailyEntries } from '../src/storage/dailyEntries.ts';
import { readWorkReport } from '../src/storage/workReport.ts';
import { readWeeklyMetrics } from '../src/storage/weeklyMetrics.ts';
import { readHistoryMetrics } from '../src/storage/historyMetrics.ts';
import { readWeeklyAssessment } from '../src/storage/weeklyAssessment.ts';
import { migrate, type BindValue } from '../src/storage/migrations.ts';
import type { QueryConnection } from '../src/storage/catalogs.ts';

const { harness, press, label } = createRequire(import.meta.url)('./helpers/reactHarness.cjs');
const migrations = JSON.parse(readFileSync('src/storage/generated/migrations.json', 'utf8'));
async function fixture() {
  const native = new DatabaseSync(':memory:');
  const sql: QueryConnection = {
    execAsync: async statement => { native.exec(statement); },
    getFirstAsync: async <T>(statement: string, ...params: BindValue[]) => native.prepare(statement).get(...params) as T ?? null,
    getAllAsync: async <T>(statement: string, ...params: BindValue[]) => native.prepare(statement).all(...params) as T[],
    runAsync: async (statement, ...params) => ({ changes: Number(native.prepare(statement).run(...params).changes) }),
  };
  await migrate(sql, migrations); return { native, sql, repo: new DailyEntries(sql, randomUUID) };
}

test('Day off derives zero only without clocks or a stored duration, preserving explicit values and incomplete schedules', () => {
  assert.equal(effectiveWorkMinutes({ work_mode: 'Day off' }), 0);
  assert.equal(effectiveWorkMinutes({ work_mode: 'Bureau' }), null);
  assert.equal(effectiveWorkMinutes({ work_mode: 'Day off', work_duration_minutes: 60 }), 60);
  assert.equal(effectiveWorkMinutes({ work_mode: 'Bureau', work_duration_minutes: 0 }), 0);
  assert.equal(effectiveWorkMinutes({ work_mode: 'Day off', work_start_time: '08:48' }), null);
  assert.equal(effectiveWorkMinutes({ work_mode: 'Day off', work_start_time: '08:48', work_duration_minutes: 447 }), 447);
  assert.equal(effectiveWorkMinutes({ work_mode: 'Day off', work_duration_minutes: 540, work_start_time: '09:00', work_morning_end_time: '12:00', work_afternoon_start_time: '11:00', work_end_time: '17:00' }), null);
  for (const value of [-1, 1.5, NaN, '0']) assert.throws(() => effectiveWorkMinutes({ work_duration_minutes: value as number }));
});

test('counter, history and assessment share the Day off interpretation without writing a synthetic zero into SQLite', async () => {
  const { native, sql, repo } = await fixture();
  try {
    let day = await repo.getOrCreate('2026-10-26');
    day = await repo.patch(day.entry_id, day.revision, { work_mode: 'Day off', weight_kg: 72 });
    const before = native.prepare('SELECT total_changes() AS n').get()!.n;
    const report = await readWorkReport(sql, day.entry_date);
    const weekly = await readWeeklyMetrics(sql, day.entry_date);
    const history = await readHistoryMetrics(sql, day.entry_date, 'month');
    const assessment = await readWeeklyAssessment(sql, day.entry_date);
    assert.equal(report.dayMinutes, 0); assert.equal(report.dayBalance, 0); assert.equal(report.afterMinutes, 0);
    assert.equal(report.incompleteDays, 0); assert.equal(report.countedDays, 1);
    assert.equal(weekly.find(item => item.key === 'work_duration_minutes')!.value, 0);
    assert.equal(history.series.find(item => item.key === 'work_duration_minutes')!.value, 0);
    assert.equal(assessment.items.find(item => item.key === 'work')!.score, scoreWork(0, 35)[0]);
    assert.equal(native.prepare('SELECT total_changes() AS n').get()!.n, before);
    assert.equal((await repo.read(day.entry_id)).work_duration_minutes, null);
    day = await repo.patch(day.entry_id, day.revision, { work_mode: 'Bureau' });
    assert.equal((await readWorkReport(sql, day.entry_date)).dayMinutes, null);
    assert.equal((await readWorkReport(sql, day.entry_date)).cumulativeMinutes, 0);
    assert.equal((await repo.read(day.entry_id)).weight_kg, 72);
  } finally { native.close(); }
});

test('real work form displays Day off as 0h00 and returns to missing duration when selecting a worked mode', async () => {
  const { native, sql } = await fixture(); const h = harness(sql); let tree: any;
  try {
    const { DailyForm } = h.load('ui/DailyForm.tsx');
    await h.act(async () => { tree = h.create(h.React.createElement(DailyForm, { database: sql, initialDate: '2026-10-26' })); });
    await press(h, tree, 'Temps de travail'); await press(h, tree, 'Day off');
    assert.match(label(tree.root), /Temps travaillé : 0h00/);
    await press(h, tree, 'Continuer →'); await h.back(); assert.match(label(tree.root), /Temps travaillé : 0h00/);
    await press(h, tree, 'Bureau'); assert.match(label(tree.root), /Temps travaillé : n.c./);
    assert.equal(native.prepare('SELECT work_duration_minutes FROM daily_entries').get()!.work_duration_minutes, null);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});
