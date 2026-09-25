import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { SportDraft, SportSessions } from '../src/storage/sportSessions.ts';
import { DailyEntries, RevisionConflict } from '../src/storage/dailyEntries.ts';
import { migrate, type SqlConnection, type BindValue } from '../src/storage/migrations.ts';

const migrations = JSON.parse(readFileSync('src/storage/generated/migrations.json', 'utf8'));
function adapter(sqlite: DatabaseSync): SqlConnection {
  return {
    execAsync: async sql => { sqlite.exec(sql); },
    getFirstAsync: async <T>(sql: string, ...params: BindValue[]) => (sqlite.prepare(sql).get(...params) as T) ?? null,
    runAsync: async (sql, ...params) => ({ changes: Number(sqlite.prepare(sql).run(...params).changes) }),
  };
}
test('distance-only session survives precise duration updates and other sessions', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    const db = adapter(sqlite); await migrate(db, migrations);
    const day = await new DailyEntries(db, randomUUID).getOrCreate('2026-09-25');
    const repo = new SportSessions(db, randomUUID);
    let first = await repo.getOrCreate(day.entry_id, 1);
    assert.equal(first.duration_minutes, null);
    first = await repo.patch(first.session_id, first.revision, { distance_km: 7.25 });
    assert.equal(first.sport_type, null);
    first = await repo.patch(first.session_id, first.revision, { sport_type: 'Course', duration_minutes: 43 });
    const second = await repo.getOrCreate(day.entry_id, 2);
    const draft = new SportDraft(repo, second);
    draft.edit({ sport_type: 'Vélo', duration_minutes: 90 });
    draft.edit({ duration_minutes: 91 });
    draft.edit({ distance_km: 12.5 });
    await draft.flush();
    assert.equal(draft.status, 'saved');
    assert.equal(draft.snapshot.distance_km, 12.5);
    assert.deepEqual(await repo.getOrCreate(day.entry_id, 1), first);
    await assert.rejects(repo.patch(first.session_id, 1, { distance_km: 0 }), RevisionConflict);
    first = await repo.patch(first.session_id, first.revision, { duration_minutes: null });
    assert.equal(first.distance_km, 7.25);
    first = await repo.patch(first.session_id, first.revision, { duration_minutes: 0 });
    assert.equal(first.duration_minutes, 0);
    await assert.rejects(repo.delete(first.session_id, 1), RevisionConflict);
    await repo.delete(first.session_id, first.revision);
    assert.equal((await repo.getOrCreate(day.entry_id, 2)).duration_minutes, 91);
    assert.equal((await new DailyEntries(db, randomUUID).getOrCreate(day.entry_date)).revision, 1);
  } finally { sqlite.close(); }
});
test('sport migration preserves existing ids, revisions and values', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    const db = adapter(sqlite); await migrate(db, migrations.slice(0, 1));
    const day = await new DailyEntries(db, randomUUID).getOrCreate('2026-09-25');
    sqlite.prepare('INSERT INTO sport_sessions VALUES (?, ?, 1, ?, 43, 7.25, 9, ?, ?)').run('synthetic', day.entry_id, 'Course', 'now', 'now');
    await migrate(db, migrations);
    const row = sqlite.prepare('SELECT * FROM sport_sessions').get();
    assert.equal(row?.session_id, 'synthetic'); assert.equal(row?.revision, 9);
    assert.equal(row?.distance_km, 7.25); assert.equal(row?.duration_minutes, 43);
    assert.equal(sqlite.prepare('PRAGMA foreign_key_check').get(), undefined);
  } finally { sqlite.close(); }
});

test('failed sport migration restores the original table and journal', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    const db = adapter(sqlite); await migrate(db, migrations.slice(0, 1));
    const day = await new DailyEntries(db, randomUUID).getOrCreate('2026-09-25');
    sqlite.prepare('INSERT INTO sport_sessions VALUES (?, ?, 1, ?, 43, 7.25, 9, ?, ?)').run('synthetic', day.entry_id, 'Course', 'now', 'now');
    const broken = migrations.map((m: { id: string; sql: string; checksum: string }, i: number) => i === 1 ? { ...m, sql: m.sql + '\nINVALID SQL;' } : m);
    await assert.rejects(migrate(db, broken));
    assert.equal(sqlite.prepare('SELECT revision FROM sport_sessions').get()?.revision, 9);
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM schema_migrations').get()?.n, 1);
    await migrate(db, migrations);
    assert.equal(sqlite.prepare('SELECT duration_minutes FROM sport_sessions').get()?.duration_minutes, 43);
  } finally { sqlite.close(); }
});
