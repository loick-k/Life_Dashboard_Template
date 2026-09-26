import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrate, type SqlConnection, type BindValue } from '../src/storage/migrations.ts';
import { Preferences } from '../src/storage/preferences.ts';
import { preferenceDefinitions, parsePreference, validatePreference, type PreferenceKey, type PreferenceValue } from '../src/domain/preferences.ts';
import { WriteQueue } from '../src/storage/writeQueue.ts';

function adapter(db: DatabaseSync): SqlConnection {
  return {
    execAsync: async sql => { db.exec(sql); },
    getFirstAsync: async <T>(sql: string, ...params: BindValue[]) => (db.prepare(sql).get(...params) as T) ?? null,
    runAsync: async (sql, ...params) => ({ changes: Number(db.prepare(sql).run(...params).changes) }),
  };
}
const migrations = JSON.parse(readFileSync('src/storage/generated/migrations.json', 'utf8'));

test('all preferences preserve generic defaults, zero, explicit absence and changes after reopening', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'life-preferences-synthetic-'));
  let db = new DatabaseSync(join(folder, 'test.db'));
  try {
    await migrate(adapter(db), migrations);
    let repo = new Preferences(adapter(db));
    const initial = await repo.readAll();
    assert.equal(db.prepare('SELECT count(*) AS n FROM settings').get()!.n, 0);
    for (const definition of preferenceDefinitions) {
      assert.deepEqual(initial[definition.key], { revision: 0, value: definition.initial });
      await repo.set(definition.key, 0, definition.initial);
    }
    await repo.set('sleep_min_hours', 1, 0);
    await repo.set('work_standard_start', 1, '06:17');
    await repo.set('tobacco_stop_date', 1, '2024-02-29');
    await repo.set('tobacco_stop_date', 2, null);
    const expected = await repo.readAll();
    db.close(); db = new DatabaseSync(join(folder, 'test.db'));
    repo = new Preferences(adapter(db));
    assert.deepEqual(await repo.readAll(), expected);
    assert.equal((await repo.read('sleep_min_hours')).value, 0);
    assert.equal((await repo.read('tobacco_stop_date')).value, null);
  } finally { db.close(); rmSync(folder, { recursive: true }); }
});

test('CAS guards initial and existing preferences while allowing independent fields', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    await migrate(adapter(db), migrations);
    const repo = new Preferences(adapter(db));
    db.prepare('INSERT INTO settings VALUES (?, ?, ?)').run('onboarding.v1', 'unchanged', '2026-09-26');
    for (const revision of [0, 1]) {
      const result = await Promise.allSettled([
        repo.set('work_standard_start', revision, '08:01'), repo.set('work_standard_start', revision, '08:02'),
      ]);
      assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal((await repo.read('work_standard_start')).value, '08:01');
    }
    await Promise.all([repo.set('work_standard_end', 0, '18:01'), repo.set('phone_max_hours', 0, 0)]);
    assert.equal((await repo.read('work_standard_start')).value, '08:01');
    assert.equal((await repo.read('phone_max_hours')).value, 0);
    assert.equal(db.prepare('SELECT value FROM settings WHERE key = ?').get('onboarding.v1')!.value, 'unchanged');
  } finally { db.close(); }
});

test('malformed, future, unknown and secret preferences fail without writes', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    await migrate(adapter(db), migrations);
    const repo = new Preferences(adapter(db));
    for (const key of ['todoist_token', '__proto__', 'sleep_min_hours; DROP TABLE settings'] as unknown as PreferenceKey[]) {
      await assert.rejects(repo.read(key));
      await assert.rejects(repo.set(key, 0, 'secret'));
    }
    await repo.set('sleep_min_hours', 0, 8);
    for (const value of [null, undefined, NaN, Infinity, -1, 13, '8'] as PreferenceValue[]) {
      await assert.rejects(repo.set('sleep_min_hours', 1, value));
      assert.deepEqual(await repo.read('sleep_min_hours'), { revision: 1, value: 8 });
    }
    for (const bad of [null, 'null', '{broken', '{"version":2}', '{"version":1,"revision":1,"value":99}']) {
      db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(bad, 'preference.v1:sleep_min_hours');
      await assert.rejects(repo.read('sleep_min_hours'));
      await assert.rejects(repo.set('sleep_min_hours', 1, 7));
      assert.equal(db.prepare('SELECT value FROM settings').get()!.value, bad);
    }
  } finally { db.close(); }
});

test('preference inputs retain incomplete drafts, V1 ranges and precise standard times', () => {
  assert.equal(parsePreference('sleep_min_hours', '7,25'), 7.25);
  assert.equal(parsePreference('work_standard_start', '08:17'), '08:17');
  assert.equal(parsePreference('close_relations_label', ' Mes proches '), 'Mes proches');
  for (const input of ['', '7,', '-2', '1e1']) assert.throws(() => parsePreference('sleep_min_hours', input));
  for (const date of ['2025-02-29', '2026-13-01', '2026-02-30', '']) assert.throws(() => parsePreference('tobacco_stop_date', date));
  for (const time of ['8:30', '08:', '24:00', '12:60', '']) assert.throws(() => parsePreference('work_standard_end', time));
  assert.throws(() => validatePreference('work_days_per_week', 0));
  assert.throws(() => validatePreference('social_weekly_goal_days', 1.5));
  assert.throws(() => validatePreference('close_relations_label', ' '));
  assert.throws(() => validatePreference('close_relations_label', 'a'.repeat(201)));
});

test('rapid preference autosaves are ordered and conflicts preserve the unconfirmed draft', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    await migrate(adapter(db), migrations);
    const repo = new Preferences(adapter(db));
    const draft = new WriteQueue(await repo.read('phone_max_hours'),
      (patch: { value: PreferenceValue }) => ({ value: validatePreference('phone_max_hours', patch.value) }),
      (row, patch) => repo.set('phone_max_hours', row.revision, patch.value));
    draft.edit({ value: 1 }); draft.edit({ value: 12 });
    await draft.flush();
    assert.equal(draft.status, 'saved');
    assert.deepEqual(await repo.read('phone_max_hours'), { revision: 2, value: 12 });
    await repo.set('phone_max_hours', 2, 3);
    draft.edit({ value: 4 });
    await assert.rejects(draft.flush());
    assert.equal(draft.status, 'failed');
    assert.equal(draft.snapshot.value, 4);
    await assert.rejects(draft.retry());
    assert.equal((await repo.read('phone_max_hours')).value, 3);
  } finally { db.close(); }
});
