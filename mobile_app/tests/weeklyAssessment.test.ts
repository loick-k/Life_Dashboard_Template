import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import * as scores from '../src/domain/assessmentScores.ts';
import { buildWeeklyAssessment, type WeeklyAssessment as Assessment } from '../src/domain/weeklyAssessment.ts';
import { readWeeklyAssessment } from '../src/storage/weeklyAssessment.ts';
import { readWorkReport } from '../src/storage/workReport.ts';
import { migrate, type BindValue } from '../src/storage/migrations.ts';
import type { QueryConnection } from '../src/storage/catalogs.ts';
import { Catalogs } from '../src/storage/catalogs.ts';
import { DailyEntries } from '../src/storage/dailyEntries.ts';
import { Preferences } from '../src/storage/preferences.ts';
import { SportSessions } from '../src/storage/sportSessions.ts';

const fixtureScores = JSON.parse(readFileSync('tests/fixtures/assessment_scores.json', 'utf8'));
const migrations = JSON.parse(readFileSync('src/storage/generated/migrations.json', 'utf8'));
const { harness, press, label } = createRequire(import.meta.url)('./helpers/reactHarness.cjs');
const item = (assessment: Assessment, key: string) => assessment.items.find(item => item.key === key)!;
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

test('all shared score boundaries and weighted complete observation match independently checked V1 fixtures', () => {
  for (const row of fixtureScores.cases) {
    const evaluate = (scores as unknown as Record<string, (...args: any[]) => scores.Score>)[row.method]!;
    assert.equal(evaluate(...row.args)[0], row.score, JSON.stringify(row));
  }
  const shared = fixtureScores.global;
  const result = buildWeeklyAssessment(shared.rows, shared.date, shared.settings);
  assert.equal(result.score, shared.score); assert.equal(result.observed, 22);
  assert.equal(scores.roundEven(82.5), 82); assert.equal(scores.roundEven(83.5), 84);
  assert.equal(scores.roundEven(-2.5), -2);
});

test('empty/missing week has no invented score, explicit zeros differ from missing and future days never contribute', () => {
  assert.equal(buildWeeklyAssessment([], '2026-10-27').score, null);
  assert.equal(buildWeeklyAssessment([{ entry_date: '2026-10-27', completed_steps: '[]', social_count: 0, social_log_count: 0, goal_count: 0, sport_count: 0 }], '2026-10-27').score, null);
  const result = buildWeeklyAssessment([
    { entry_date: '2026-10-25', alcohol_glasses: 50 },
    { entry_date: '2026-10-26', alcohol_glasses: 0, phone_minutes: 0, me_time_writing_minutes: 0, social_count: 0, social_log_count: 1, goal_count: 1, goals_worked: 0, sport_count: 0, completed_steps: '["sport"]' },
    { entry_date: '2026-10-28', alcohol_glasses: 50 },
  ], '2026-10-27');
  assert.equal(result.elapsedDays, 2); assert.equal(item(result, 'alcohol').score, 100);
  assert.equal(item(result, 'phone').score, 100); assert.equal(item(result, 'writing').score, 35);
  assert.equal(item(result, 'social').score, 35); assert.equal(item(result, 'goals').score, 25);
  assert.equal(item(result, 'sport').score, 25); assert.equal(item(result, 'sleep').score, null);
  assert.throws(() => buildWeeklyAssessment([{ entry_date: '2026-10-26' }, { entry_date: '2026-10-26' }], '2026-10-27'));
});

test('seven formerly unused preferences affect real indicators without changing the fixed daily work counter', () => {
  const rows = [{ entry_date: '2026-10-26', sleep_hours: 6, belly_cm: 85, phone_minutes: 180, sport_minutes: 120, social_count: 1, work_mode: 'Bureau', work_duration_minutes: 462 }];
  const baseline = buildWeeklyAssessment(rows, '2026-10-27');
  const changed = buildWeeklyAssessment(rows, '2026-10-27', {
    sleep_min_hours: 6, belly_goal_cm: 85, phone_max_hours: 1, sport_weekly_goal_hours: 1,
    social_weekly_goal_days: 1, work_days_per_week: 1, tobacco_stop_date: '2026-10-20',
  });
  assert.equal(item(baseline, 'sleep').score, 75); assert.equal(item(changed, 'sleep').score, 100);
  assert.equal(item(baseline, 'belly').score, 60); assert.equal(item(changed, 'belly').score, 100);
  assert.equal(item(baseline, 'phone').score, 100); assert.equal(item(changed, 'phone').score, 25);
  assert.equal(item(baseline, 'sport').score, 70); assert.equal(item(changed, 'sport').score, 100);
  assert.equal(item(baseline, 'social').score, 70); assert.equal(item(changed, 'social').score, 100);
  assert.equal(item(baseline, 'work_tracking').score, 75); assert.equal(item(changed, 'work_tracking').score, 100);
  assert.equal(item(baseline, 'tobacco').score, null); assert.equal(item(changed, 'tobacco').score, 70);
  assert.equal(item(changed, 'work_tracking').weight, 0);
  assert.equal(scores.scorePhone(4.2, 3)[0], 70); // Correct V1's decimal boundary (3*1.4 < 4.2 in binary).
  assert.equal(scores.scorePhone(0, 0)[0], 100); assert.equal(scores.scorePhone(1 / 60, 0)[0], 25);
  assert.equal(scores.scoreSleep(8, 0)[0], null); assert.equal(scores.scoreSport(2, 0)[0], null);
  assert.equal(scores.scoreSocial(1, 0)[0], null); assert.equal(scores.scoreWork(20, 0)[0], null);
  assert.equal(item(buildWeeklyAssessment(rows, '2026-10-27', { tobacco_stop_date: '2026-10-28' }), 'tobacco').score, null);
});

test('stale estimates and overlapping work are excluded but actual meals remain tracked', () => {
  const result = buildWeeklyAssessment([{
    entry_date: '2026-10-26', kcal: 2000, proteins_g: 100, nutrition_estimate_stale: 1,
    meal_lunch: 'Repas fictif', work_duration_minutes: 600, work_mode: 'Bureau',
    work_start_time: '09:00', work_morning_end_time: '12:00', work_afternoon_start_time: '11:00', work_end_time: '18:00',
  }], '2026-10-27');
  assert.equal(result.staleEstimates, 1); assert.equal(item(result, 'kcal').score, null);
  assert.equal(item(result, 'proteins_g').score, null); assert.equal(item(result, 'nutrition').score, 30);
  assert.equal(item(result, 'work').score, null); assert.deepEqual(result.excludedWorkDates, ['2026-10-26']);
});

test('SQLite reads each relation once, preserves social deselection and goals notes; assessment never writes', async () => {
  const { native, sql } = await fixture();
  try {
    const repo = new DailyEntries(sql, randomUUID); let day = await repo.getOrCreate('2026-10-26');
    day = await repo.patch(day.entry_id, day.revision, { sleep_hours: 6, phone_minutes: 180, work_start_time: '08:00', work_end_time: '15:42', work_mode: 'Bureau' });
    const sports = new SportSessions(sql, randomUUID); const sport = await sports.getOrCreate(day.entry_id, 1);
    await sports.patch(sport.session_id, sport.revision, { duration_minutes: 120 });
    const people = new Catalogs(sql, randomUUID, 'friends'); const id = await people.create('Personne fictive');
    const log = await people.select(day.entry_id, id); await people.deselect(log);
    const goals = new Catalogs(sql, randomUUID, 'goals'); const goal = await goals.create('Objectif fictif');
    await goals.select(day.entry_id, goal); await goals.select(day.entry_id, goal);
    const before = native.prepare('SELECT total_changes() AS n').get()!.n;
    const result = await readWeeklyAssessment(sql, '2026-10-27');
    assert.equal(native.prepare('SELECT total_changes() AS n').get()!.n, before);
    assert.equal(item(result, 'social').score, 35); assert.equal(item(result, 'goals').score, 100);
    assert.equal(item(result, 'sport').score, 70);
    const balance = (await readWorkReport(sql, '2026-10-27')).cumulativeMinutes;
    await new Preferences(sql).set('work_days_per_week', 0, 1);
    assert.equal((await readWorkReport(sql, '2026-10-27')).cumulativeMinutes, balance);
  } finally { native.close(); }
});

test('assessment screen retries loading and refreshes after saved preference edits while preserving expanded detail', async () => {
  const { native, sql } = await fixture(); let fail = true, tree: any;
  const port = { ...sql, getAllAsync: async <T>(statement: string, ...params: BindValue[]) => {
    if (fail) throw new Error('Synthetic unavailable read'); return sql.getAllAsync<T>(statement, ...params);
  } }; const h = harness(port);
  try {
    const day = await new DailyEntries(sql, randomUUID).getOrCreate('2026-10-26');
    await new DailyEntries(sql, randomUUID).patch(day.entry_id, day.revision, { phone_minutes: 180 });
    const { WeeklyAssessment } = h.load('ui/WeeklyAssessment.tsx');
    const props = { database: port, date: '2026-10-27' };
    await h.act(async () => { tree = h.create(h.React.createElement(WeeklyAssessment, props)); });
    assert.match(label(tree.root), /Évaluation indisponible/); fail = false;
    await press(h, tree, 'Réessayer l’évaluation'); await press(h, tree, 'Voir le détail des indicateurs');
    assert.match(label(tree.root), /Temps de portable · 100\/100/);
    await new Preferences(sql).set('phone_max_hours', 0, 1);
    await h.act(async () => tree.update(h.React.createElement(WeeklyAssessment, { ...props, refreshToken: 1 })));
    assert.match(label(tree.root), /Temps de portable · 25\/100/);
    assert.match(label(tree.root), /Masquer le détail des indicateurs/);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});
