import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { migrate, type SqlConnection, type BindValue } from '../src/storage/migrations.ts';
import { DailyEntries, RevisionConflict } from '../src/storage/dailyEntries.ts';
import { readProgress, setCheckinProgress, indicatorIds } from '../src/storage/checkinProgress.ts';

function adapter(db: DatabaseSync): SqlConnection {
  return {
    execAsync: async sql => { db.exec(sql); },
    getFirstAsync: async <T>(sql: string, ...params: BindValue[]) => (db.prepare(sql).get(...params) as T) ?? null,
    runAsync: async (sql, ...params) => ({ changes: Number(db.prepare(sql).run(...params).changes) }),
  };
}
const migrations = JSON.parse(readFileSync('src/storage/generated/migrations.json', 'utf8'));

test('completed and skipped steps are exclusive, reversible and preserve every measure', async () => {
  const db = new DatabaseSync(':memory:'); const connection = adapter(db);
  try {
    await migrate(connection, migrations);
    const repo = new DailyEntries(connection, randomUUID);
    let row = await repo.getOrCreate('2026-09-25');
    row = await repo.patch(row.entry_id, row.revision, { weight_kg: 70, work_start_time: '08:48', phone_minutes: 0 });
    const saved = row;
    row = await setCheckinProgress(connection, row, { step: 'weight', status: 'skipped' });
    assert.deepEqual(readProgress(row).skipped, ['weight']);
    row = await setCheckinProgress(connection, row, { step: 'weight', status: 'completed' });
    assert.deepEqual(readProgress(row).skipped, []);
    assert.equal(readProgress(row).count, 1);
    for (const key of Object.keys(saved).filter(k => !['completed_steps', 'skipped_steps', 'revision', 'updated_at'].includes(k))) assert.equal(row[key], saved[key]);
    await assert.rejects(setCheckinProgress(connection, saved, { step: 'sleep', status: 'completed' }), RevisionConflict);
    await assert.rejects(setCheckinProgress(connection, row, { finish: true }));
    for (const step of indicatorIds) row = await setCheckinProgress(connection, row, { step, status: 'completed' });
    row = await setCheckinProgress(connection, row, { finish: true });
    assert.equal(readProgress(await repo.getOrCreate('2026-09-25')).finished, true);
    assert.equal(readProgress(await repo.getOrCreate('2026-09-24')).count, 0);
    row = await repo.patch(row.entry_id, row.revision, { weight_kg: 71 });
    assert.equal(readProgress(row).count, 13);
    assert.equal(row.work_start_time, '08:48');
  } finally { db.close(); }
});

test('unknown, duplicate and overlapping progress is refused without replacement', async () => {
  const db = new DatabaseSync(':memory:'); const connection = adapter(db);
  try {
    await migrate(connection, migrations);
    const row = await new DailyEntries(connection, randomUUID).getOrCreate('2026-09-25');
    for (const completed_steps of ['["unknown"]', '["sleep","sleep"]', 'null', '{}']) {
      assert.throws(() => readProgress({ ...row, completed_steps }));
    }
    assert.throws(() => readProgress({ ...row, completed_steps: '["sleep"]', skipped_steps: '["sleep"]' }));
    await assert.rejects(setCheckinProgress(connection, row, { step: 'summary', status: 'completed' }));
    assert.equal(readProgress(row).count, 0);
  } finally { db.close(); }
});
