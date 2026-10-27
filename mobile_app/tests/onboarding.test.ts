import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrate, type SqlConnection, type BindValue } from '../src/storage/migrations.ts';
import { OnboardingProgress, onboardingSteps } from '../src/storage/onboarding.ts';

function adapter(db: DatabaseSync): SqlConnection {
  return {
    execAsync: async sql => { db.exec(sql); },
    getFirstAsync: async <T>(sql: string, ...params: BindValue[]) => (db.prepare(sql).get(...params) as T) ?? null,
    runAsync: async (sql, ...params) => ({ changes: Number(db.prepare(sql).run(...params).changes) }),
  };
}
const migrations = JSON.parse(readFileSync('src/storage/generated/migrations.json', 'utf8'));

test('onboarding resumes after reopening and remains completed across launches', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'life-onboarding-synthetic-'));
  let db = new DatabaseSync(join(folder, 'test.db'));
  try {
    await migrate(adapter(db), migrations);
    let repo = new OnboardingProgress(adapter(db));
    let state = await repo.read();
    assert.equal(state.step, 'welcome');
    state = await repo.move(state.revision, 'data');
    state = await repo.chooseData(state.revision, 'empty');
    db.close();
    db = new DatabaseSync(join(folder, 'test.db'));
    repo = new OnboardingProgress(adapter(db));
    assert.deepEqual(await repo.read(), state);
    for (const step of onboardingSteps.slice(2)) state = await repo.move(state.revision, step);
    state = await repo.finish(state.revision);
    db.close();
    db = new DatabaseSync(join(folder, 'test.db'));
    repo = new OnboardingProgress(adapter(db));
    assert.deepEqual(await repo.read(), state);
    await assert.rejects(repo.move(state.revision, 'integrations'), /déjà terminée/);
  } finally { db.close(); rmSync(folder, { recursive: true }); }
});

test('stale onboarding views cannot overwrite newer choices or other settings', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    await migrate(adapter(db), migrations);
    const repo = new OnboardingProgress(adapter(db));
    await repo.read();
    db.prepare('INSERT INTO settings VALUES (?, ?, ?)').run('work.target', '462', '2026-09-25');
    const data = await repo.move(1, 'data');
    const results = await Promise.allSettled([repo.chooseData(data.revision, 'empty'), repo.chooseData(data.revision, 'import-v1')]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal((await repo.read()).dataChoice, 'empty');
    assert.equal(db.prepare('SELECT value FROM settings WHERE key = ?').get('work.target')!.value, '462');
  } finally { db.close(); }
});

test('invalid navigation and corrupt or future state never reset progress', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    await migrate(adapter(db), migrations);
    const repo = new OnboardingProgress(adapter(db));
    await repo.read();
    await assert.rejects(repo.move(1, 'review'));
    await assert.rejects(repo.finish(1));
    const data = await repo.move(1, 'data');
    await assert.rejects(repo.move(data.revision, 'preferences'));
    for (const bad of ['{broken', '{"version":2}', 'null']) {
      db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(bad, 'onboarding.v1');
      await assert.rejects(repo.read());
      assert.equal(db.prepare('SELECT value FROM settings WHERE key = ?').get('onboarding.v1')!.value, bad);
    }
  } finally { db.close(); }
});

test('existing-device choice survives reload without changing stored entries or preferences', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const sql = adapter(db); await migrate(sql, migrations);
    db.prepare('INSERT INTO settings VALUES (?, ?, ?)').run('preference.v1:phone_max_hours', '{"version":1,"revision":1,"value":0}', '2026-10-27');
    db.prepare('INSERT INTO daily_entries (entry_id, entry_date, weight_kg, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('synthetic-entry', '2026-10-26', 73.4, '2026-10-27', '2026-10-27');
    const repo = new OnboardingProgress(sql);
    let state = await repo.read();
    state = await repo.move(state.revision, 'data');
    state = await repo.chooseData(state.revision, 'existing');
    assert.deepEqual(await new OnboardingProgress(sql).read(), state);
    await repo.move(state.revision, 'preferences');
    assert.equal(db.prepare('SELECT weight_kg FROM daily_entries').get()!.weight_kg, 73.4);
    assert.equal(db.prepare('SELECT value FROM settings WHERE key = ?').get('preference.v1:phone_max_hours')!.value, '{"version":1,"revision":1,"value":0}');
  } finally { db.close(); }
});
