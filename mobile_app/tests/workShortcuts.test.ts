import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { migrate, type SqlConnection, type BindValue } from '../src/storage/migrations.ts';
import { DailyEntries } from '../src/storage/dailyEntries.ts';
import { Preferences } from '../src/storage/preferences.ts';
import { standardWorkPatch, previousWorkPatch } from '../src/storage/workShortcuts.ts';

function adapter(db: DatabaseSync): SqlConnection {
  return {
    execAsync: async sql => { db.exec(sql); },
    getFirstAsync: async <T>(sql: string, ...params: BindValue[]) => (db.prepare(sql).get(...params) as T) ?? null,
    runAsync: async (sql, ...params) => ({ changes: Number(db.prepare(sql).run(...params).changes) }),
  };
}
const migrations = JSON.parse(readFileSync('src/storage/generated/migrations.json', 'utf8'));

test('standard hours use confirmed preferences in one patch, preserving third slot and other indicators', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const sql = adapter(db); await migrate(sql, migrations);
    const repo = new DailyEntries(sql, randomUUID);
    let today = await repo.getOrCreate('2026-09-26');
    today = await repo.patch(today.entry_id, today.revision, { weight_kg: 72.3, work_mode: 'Bureau', work_third_start_time: '18:12', work_third_end_time: '18:42' });
    await new Preferences(sql).set('work_standard_start', 0, '08:17');
    const before = db.prepare('SELECT total_changes() AS n').get()!.n;
    const patch = await standardWorkPatch(sql);
    assert.equal(db.prepare('SELECT total_changes() AS n').get()!.n, before);
    assert.deepEqual(patch, { work_start_time: '08:17', work_morning_end_time: '12:30', work_afternoon_start_time: '13:30', work_end_time: '17:30' });
    const after = await repo.patch(today.entry_id, today.revision, patch);
    assert.equal(after.revision, today.revision + 1);
    assert.equal(after.weight_kg, 72.3);
    assert.equal(after.work_mode, 'Bureau');
    assert.equal(after.work_third_start_time, '18:12');
    assert.equal(after.work_duration_minutes, 523);
    await assert.rejects(repo.patch(today.entry_id, today.revision, patch));
  } finally { db.close(); }
});

test('previous hours preserve partial schedules and never invent yesterday or erase current fields', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const sql = adapter(db); await migrate(sql, migrations);
    const repo = new DailyEntries(sql, randomUUID);
    assert.deepEqual(await previousWorkPatch(sql, '2026-03-01'), {});
    assert.equal(db.prepare('SELECT count(*) AS n FROM daily_entries').get()!.n, 0);
    let previous = await repo.getOrCreate('2026-02-28');
    previous = await repo.patch(previous.entry_id, previous.revision, { work_start_time: '08:19', work_third_start_time: '19:17', work_third_end_time: '20:21' });
    let today = await repo.getOrCreate('2026-03-01');
    today = await repo.patch(today.entry_id, today.revision, { work_morning_end_time: '12:12', work_afternoon_start_time: '13:13', body_fat_pct: 17 });
    const patch = await previousWorkPatch(sql, today.entry_date);
    assert.deepEqual(patch, { work_start_time: '08:19', work_third_start_time: '19:17', work_third_end_time: '20:21' });
    const after = await repo.patch(today.entry_id, today.revision, patch);
    assert.equal(after.work_morning_end_time, '12:12');
    assert.equal(after.work_afternoon_start_time, '13:13');
    assert.equal(after.body_fat_pct, 17);
    assert.deepEqual(await repo.getOrCreate('2026-02-28'), previous);
    await assert.rejects(previousWorkPatch(sql, '2026-02-30'));
  } finally { db.close(); }
});

test('invalid standard hours stop preparation without changing any day', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const sql = adapter(db); await migrate(sql, migrations);
    db.prepare('INSERT INTO settings VALUES (?, ?, ?)').run('preference.v1:work_standard_start', '{"version":1,"revision":1,"value":"99:00"}', '2026-09-26');
    await assert.rejects(standardWorkPatch(sql));
    assert.equal(db.prepare('SELECT count(*) AS n FROM daily_entries').get()!.n, 0);
  } finally { db.close(); }
});
