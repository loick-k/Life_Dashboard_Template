import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { DailyEntries } from '../src/storage/dailyEntries.ts';
import { migrate, type BindValue } from '../src/storage/migrations.ts';
import type { QueryConnection } from '../src/storage/catalogs.ts';
import { readWorkReport } from '../src/storage/workReport.ts';

const { harness, press, input } = createRequire(import.meta.url)('./helpers/reactHarness.cjs');
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

test('changing only work mode preserves stored V1 durations, including zero and incomplete clocks', async () => {
  const { native, sql, repo } = await fixture();
  try {
    for (const [index, minutes, start] of [[1, 462, null], [2, 447, '08:48'], [3, 0, null]] as const) {
      let day = await repo.getOrCreate(`2026-10-0${index}`);
      await sql.runAsync('UPDATE daily_entries SET work_duration_minutes = ?, work_start_time = ?, weight_kg = 72, body_fat_pct = 18 WHERE entry_id = ?', minutes, start, day.entry_id);
      day = await repo.read(day.entry_id);
      for (const mode of ['Bureau', 'Télétravail', 'Day off', 'Déplacement', 'Bureau']) {
        day = await repo.patch(day.entry_id, day.revision, { work_mode: mode });
        assert.equal(day.work_duration_minutes, minutes); assert.equal(day.work_start_time, start);
        assert.equal(day.weight_kg, 72); assert.equal(day.body_fat_pct, 18);
      }
      day = await repo.patch(day.entry_id, day.revision, { work_start_time: start, work_end_time: null });
      assert.equal(day.work_duration_minutes, minutes, 'an unchanged clock patch is not a duration deletion');
      assert.equal((await repo.read(day.entry_id)).work_duration_minutes, minutes);
    }
  } finally { native.close(); }
});

test('an actual clock change recalculates or explicitly invalidates duration without deleting other fields', async () => {
  const { native, repo } = await fixture();
  try {
    let day = await repo.getOrCreate('2026-10-26');
    day = await repo.patch(day.entry_id, day.revision, { work_mode: 'Bureau', work_start_time: '08:48', work_morning_end_time: '12:30', work_afternoon_start_time: '13:30', work_end_time: '17:30', weight_kg: 72 });
    assert.equal(day.work_duration_minutes, 462);
    day = await repo.patch(day.entry_id, day.revision, { work_end_time: '18:00' });
    assert.equal(day.work_duration_minutes, 492);
    day = await repo.patch(day.entry_id, day.revision, { work_morning_end_time: null });
    assert.equal(day.work_duration_minutes, null); assert.equal(day.work_start_time, '08:48');
    assert.equal(day.work_afternoon_start_time, '13:30'); assert.equal(day.work_end_time, '18:00'); assert.equal(day.weight_kg, 72);
  } finally { native.close(); }
});

test('real work form keeps an imported duration when selecting a mode and returning to the step', async () => {
  const { native, sql, repo } = await fixture(); const h = harness(sql); let tree: any;
  try {
    const day = await repo.getOrCreate('2026-10-26');
    await sql.runAsync('UPDATE daily_entries SET work_duration_minutes = 447, work_start_time = ?, work_mode = ?, weight_kg = 72 WHERE entry_id = ?', '08:48', 'Bureau', day.entry_id);
    const { DailyForm } = h.load('ui/DailyForm.tsx');
    await h.act(async () => { tree = h.create(h.React.createElement(DailyForm, { database: sql, initialDate: day.entry_date })); });
    await press(h, tree, 'Temps de travail'); await press(h, tree, 'Télétravail');
    await press(h, tree, 'Continuer →'); await h.back();
    assert.equal(input(tree, 'Heure de début').props.value, '08:48');
    assert.equal((await repo.read(day.entry_id)).work_duration_minutes, 447);
    assert.equal((await readWorkReport(sql, day.entry_date)).dayMinutes, 447);
    assert.equal((await repo.read(day.entry_id)).weight_kg, 72);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});
