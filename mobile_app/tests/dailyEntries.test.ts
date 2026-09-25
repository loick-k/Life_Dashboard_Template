import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DailyEntries, RevisionConflict, validateDate, validatePatch, type DailyPatch } from '../src/storage/dailyEntries.ts';
import { migrate, type SqlConnection, type BindValue } from '../src/storage/migrations.ts';

function adapter(sqlite: DatabaseSync): SqlConnection {
  return {
    execAsync: async sql => { sqlite.exec(sql); },
    getFirstAsync: async <T>(sql: string, ...params: BindValue[]) => (sqlite.prepare(sql).get(...params) as T) ?? null,
    runAsync: async (sql, ...params) => ({ changes: Number(sqlite.prepare(sql).run(...params).changes) }),
  };
}
const migrations = JSON.parse(readFileSync('src/storage/generated/migrations.json', 'utf8'));

test('partial times, weight and fat survive other updates and reopening', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'life-synthetic-'));
  let sqlite = new DatabaseSync(join(dir, 'test.db'));
  try {
    await migrate(adapter(sqlite), migrations);
    let repo = new DailyEntries(adapter(sqlite), randomUUID);
    let day = await repo.getOrCreate('2026-09-25');
    day = await repo.patch(day.entry_id, day.revision, { weight_kg: 72.4, body_fat_pct: 18.5 });
    day = await repo.patch(day.entry_id, day.revision, { work_start_time: '08:48' });
    day = await repo.patch(day.entry_id, day.revision, { work_morning_end_time: '12:30', work_afternoon_start_time: '13:30' });
    assert.equal(day.work_start_time, '08:48');
    assert.equal(day.work_duration_minutes, null);
    day = await repo.patch(day.entry_id, day.revision, { work_end_time: '17:30' });
    assert.equal(day.work_duration_minutes, 462);
    day = await repo.patch(day.entry_id, day.revision, { work_end_time: null });
    assert.equal(day.work_duration_minutes, null);
    sqlite.close();
    sqlite = new DatabaseSync(join(dir, 'test.db'));
    repo = new DailyEntries(adapter(sqlite), randomUUID);
    const reopened = await repo.getOrCreate('2026-09-25');
    assert.equal(reopened.entry_id, day.entry_id);
    assert.equal(reopened.weight_kg, 72.4);
    assert.equal(reopened.body_fat_pct, 18.5);
    assert.equal(reopened.work_end_time, null);
    assert.equal(reopened.work_afternoon_start_time, '13:30');
    const other = await repo.getOrCreate('2026-09-24');
    assert.equal(other.weight_kg, null);
  } finally { sqlite.close(); rmSync(dir, { recursive: true }); }
});

test('stale views and concurrent writes cannot overwrite recent values', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    await migrate(adapter(sqlite), migrations);
    const repo = new DailyEntries(adapter(sqlite), randomUUID);
    const day = await repo.getOrCreate('2026-09-25');
    const results = await Promise.allSettled([
      repo.patch(day.entry_id, day.revision, { weight_kg: 70 }),
      repo.patch(day.entry_id, day.revision, { weight_kg: 80 }),
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    await assert.rejects(repo.patch(day.entry_id, day.revision, { body_fat_pct: 22 }), RevisionConflict);
    assert.equal((await repo.getOrCreate(day.entry_date)).weight_kg, 70);
  } finally { sqlite.close(); }
});

test('zero, omission and explicit null are distinct', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    await migrate(adapter(sqlite), migrations);
    const repo = new DailyEntries(adapter(sqlite), randomUUID);
    let day = await repo.getOrCreate('2026-09-25');
    day = await repo.patch(day.entry_id, day.revision, { alcohol_glasses: 0, weight_kg: 70 });
    day = await repo.patch(day.entry_id, day.revision, { weight_kg: undefined, phone_minutes: 0 });
    assert.equal(day.weight_kg, 70);
    assert.equal(day.alcohol_glasses, 0);
    day = await repo.patch(day.entry_id, day.revision, { weight_kg: null });
    assert.equal(day.weight_kg, null);
    assert.equal(day.phone_minutes, 0);
  } finally { sqlite.close(); }
});

test('invalid fields, numbers, clocks and dates are refused', () => {
  for (const patch of [{ weight_kg: NaN }, { phone_minutes: -1 }, { work_start_time: '25:00' }, { phone_minutes: 1.5 }, { revision: 5 }]) {
    assert.throws(() => validatePatch(patch as DailyPatch));
  }
  assert.throws(() => validateDate('2026-02-30'));
  assert.throws(() => validateDate('25/09/2026'));
  assert.doesNotThrow(() => validateDate('2024-02-29'));
});
