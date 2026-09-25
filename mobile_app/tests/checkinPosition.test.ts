import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrate, type SqlConnection, type BindValue } from '../src/storage/migrations.ts';
import { CheckinPositions } from '../src/storage/checkinPosition.ts';
import { DailyEntries } from '../src/storage/dailyEntries.ts';

function adapter(db: DatabaseSync): SqlConnection {
  return {
    execAsync: async sql => { db.exec(sql); },
    getFirstAsync: async <T>(sql: string, ...params: BindValue[]) => (db.prepare(sql).get(...params) as T) ?? null,
    runAsync: async (sql, ...params) => ({ changes: Number(db.prepare(sql).run(...params).changes) }),
  };
}
const migrations = JSON.parse(readFileSync('src/storage/generated/migrations.json', 'utf8'));
test('cursor survives reopening, remains date-specific and cannot change metrics', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'life-position-synthetic-'));
  let db = new DatabaseSync(join(folder, 'test.db'));
  try {
    await migrate(adapter(db), migrations);
    const entries = new DailyEntries(adapter(db), randomUUID);
    const day = await entries.getOrCreate('2026-09-25');
    const saved = await entries.patch(day.entry_id, day.revision, { weight_kg: 72, work_start_time: '08:48' });
    let repo = new CheckinPositions(adapter(db));
    const cursor = await repo.read(day.entry_date);
    const work = await repo.move(day.entry_date, cursor.revision, 'work');
    assert.deepEqual(await entries.getOrCreate(day.entry_date), saved);
    assert.equal((await repo.read('2026-09-24')).step, 'sleep');
    db.close(); db = new DatabaseSync(join(folder, 'test.db'));
    repo = new CheckinPositions(adapter(db));
    assert.deepEqual(await repo.read(day.entry_date), work);
    await assert.rejects(repo.move(day.entry_date, cursor.revision, 'sleep'));
    assert.equal((await repo.read(day.entry_date)).step, 'work');
    const returned = await repo.move(day.entry_date, work.revision, 'fat');
    assert.equal(returned.step, 'fat');
    assert.equal((await new DailyEntries(adapter(db), randomUUID).getOrCreate(day.entry_date)).work_start_time, '08:48');
  } finally { db.close(); rmSync(folder, { recursive: true }); }
});
test('invalid dates, unknown steps and corrupt cursors do not reset history', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    await migrate(adapter(db), migrations);
    const repo = new CheckinPositions(adapter(db));
    await assert.rejects(repo.read('2026-02-30'));
    await repo.read('2026-09-25');
    await assert.rejects(repo.move('2026-09-25', 1, 'unknown'));
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('{"version":99}', 'checkin.position:2026-09-25');
    await assert.rejects(repo.read('2026-09-25'));
    assert.equal(db.prepare('SELECT value FROM settings WHERE key = ?').get('checkin.position:2026-09-25')!.value, '{"version":99}');
  } finally { db.close(); }
});
