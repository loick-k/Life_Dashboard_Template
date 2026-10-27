import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { migrate, type BindValue } from '../src/storage/migrations.ts';
import type { QueryConnection } from '../src/storage/catalogs.ts';
import { canonical, v1Tables, type V1Bundle, type V1Row, type V1Table } from '../src/storage/v1Format.ts';
import { importV1 } from '../src/storage/v1Import.ts';
import { convertV1Progress } from '../src/storage/v1Progress.ts';
import { captureSnapshot, restoreSnapshot } from '../src/storage/backupSnapshot.ts';
import { DailyEntries } from '../src/storage/dailyEntries.ts';
import { Catalogs } from '../src/storage/catalogs.ts';

const migrations = JSON.parse(readFileSync('src/storage/generated/migrations.json', 'utf8'));
const crypto = { sha256: async (text: string) => createHash('sha256').update(text).digest('hex') };
function adapter(db: DatabaseSync): QueryConnection {
  return {
    execAsync: async sql => { db.exec(sql); },
    getFirstAsync: async <T>(sql: string, ...params: BindValue[]) => (db.prepare(sql).get(...params) as T) ?? null,
    getAllAsync: async <T>(sql: string, ...params: BindValue[]) => db.prepare(sql).all(...params) as T[],
    runAsync: async (sql, ...params) => ({ changes: Number(db.prepare(sql).run(...params).changes) }),
  };
}
const stamp = '2026-08-04T19:00:00+02:00';
function fixture(): Partial<Record<V1Table, V1Row[]>> {
  return {
    daily_entries: [
      { entry_date: '2026-08-03', weight_kg: 73.4, body_fat_pct: 0, belly_cm: null, waist_cm: 83, nap_minutes: 15,
        work_travel: 'Bureau', work_start_time: '08:17', work_morning_end_time: null, work_third_start_time: '18:13', work_hours: 7.7,
        phone_hours: 1.25, meal_lunch: 'Repas synthétique 🥗', kcal: 2100, sport_kcal_burned: 200,
        checkin_completed_steps: '[0,1,5]', checkin_skipped_steps: '[]', checkin_finished: 0, checkin_version: 5, updated_at: stamp },
      { entry_date: '2026-08-04', weight_kg: null, alcohol_glasses: 0, work_travel: 'Day off', work_duration_hours: 0,
        sport_type: 'Course', sport_hours: 1.5, phone_hours: 0, updated_at: stamp },
    ],
    sport_sessions: [{ entry_date: '2026-08-03', session_index: 1, session_id: 'stable-source-uuid', sport_type: 'Course', duration_minutes: null, distance_km: 0 }],
    friends: [{ id: 1, name: 'Relation A synthétique', category: 'Ami', active: 1, created_at: stamp }, { id: 2, name: 'Relation B synthétique', category: 'Famille', active: 0, created_at: stamp }],
    social_logs: [{ id: 1, entry_date: '2026-08-03', friend_id: 2, context: 'Appel', duration_hours: 0.5, note: 'Note fictive', updated_at: stamp }],
    goals: [{ id: 1, title: 'Objectif A fictif', active: 1, created_at: stamp, completed_at: null }, { id: 2, title: 'Objectif B fictif', active: 0, created_at: stamp, completed_at: stamp }],
    goal_logs: [{ entry_date: '2026-08-03', goal_id: 2, worked: 0, note: 'Historique fictif à conserver', updated_at: stamp }],
    settings: [{ key: 'phone_max_hours', value: '0' }, { key: 'tobacco_stop_date', value: '' }, { key: 'todoist_api_token', value: 'synthetic-secret-excluded' }],
    checkin_progress: [{ entry_date: '2026-08-04', version: 1, completed_steps: JSON.stringify(Array.from({ length: 11 }, (_, i) => i)), skipped_steps: '[]', finished: 1, updated_at: stamp }],
    todo_categories: [{ id: 1, name: 'Catégorie fictive', created_at: stamp }],
    todo_items: [{ id: 1, title: 'Ancienne tâche fictive', completed: 1, category_id: 1, priority: 'Normale', created_at: stamp, updated_at: stamp }],
    api_usage_logs: [{ id: 1, entry_date: '2026-08-03', provider: 'synthetic', model: 'synthetic', input_tokens: 10, output_tokens: 5, created_at: stamp }],
    schema_migrations: [{ migration_id: 'legacy-schema', checksum: 'synthetic', applied_at: stamp }],
  };
}
async function bundle(tables = fixture()): Promise<string> {
  const packed = {} as V1Bundle['tables'];
  for (const table of v1Tables) { const rows = tables[table] ?? []; packed[table] = { rows, checksum: await crypto.sha256(canonical(rows)) }; }
  return JSON.stringify({ format: 'life-dashboard-v1-export', version: 1, sourceId: 'synthetic-v1', createdAt: stamp, tables: packed });
}

test('preview rolls back; import preserves units, zeros, partial data, relations, archives and V1 progression', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const sql = adapter(db); await migrate(sql, migrations); const raw = await bundle();
    const preview = await importV1(sql, raw, crypto, { dryRun: true });
    assert.equal(db.prepare('SELECT count(*) AS n FROM daily_entries').get()!.n, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM v1_import_runs').get()!.n, 0);
    const result = await importV1(sql, raw, crypto, { dryRun: false, expectedFingerprint: preview.fingerprint });
    assert.equal(result.excludedSettings, 1);
    const days = await sql.getAllAsync<Record<string, BindValue>>('SELECT * FROM daily_entries ORDER BY entry_date');
    assert.equal(days.length, 2); assert.match(String(days[0]!.entry_id), /^[0-9a-f-]{36}$/);
    assert.equal(days[0]!.phone_minutes, 75); assert.equal(days[0]!.work_duration_minutes, 462);
    assert.equal(days[0]!.work_start_time, '08:17'); assert.equal(days[0]!.work_morning_end_time, null);
    assert.equal(days[0]!.work_third_start_time, '18:13'); assert.equal(days[0]!.body_fat_pct, 0); assert.equal(days[0]!.belly_cm, 83);
    assert.equal(days[0]!.meal_lunch, 'Repas synthétique 🥗'); assert.equal(days[0]!.updated_at, '2026-08-04T17:00:00.000Z');
    assert.deepEqual(JSON.parse(String(days[0]!.completed_steps)), ['sleep', 'alcohol', 'work']);
    assert.equal(days[1]!.checkin_finished, 1); assert.equal(days[1]!.work_duration_minutes, 0);
    const sports = await sql.getAllAsync<{ duration_minutes: number | null; distance_km: number | null }>('SELECT * FROM sport_sessions ORDER BY entry_id');
    assert.equal(sports.length, 2); assert.ok(sports.some(item => item.duration_minutes === null && item.distance_km === 0));
    assert.ok(sports.some(item => item.duration_minutes === 90));
    assert.equal(db.prepare('SELECT duration_minutes FROM social_logs').get()!.duration_minutes, 30);
    assert.equal(db.prepare('SELECT worked FROM goal_logs').get()!.worked, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM v1_import_archive WHERE source_table = ?').get('todo_items')!.n, 1);
    assert.ok(!(JSON.stringify(await captureSnapshot(sql, migrations))).includes('synthetic-secret-excluded'));
    assert.equal(db.prepare('PRAGMA foreign_key_check').get(), undefined);
  } finally { db.close(); }
});

test('repeat after reopening preserves V2 edits; a later snapshot may add new dates without duplicates', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'life-v1-synthetic-')); const path = join(folder, 'test.db');
  let db = new DatabaseSync(path);
  try {
    let sql = adapter(db); await migrate(sql, migrations); const raw = await bundle();
    await importV1(sql, raw, crypto, { dryRun: false });
    let repo = new DailyEntries(sql, randomUUID), day = await repo.getOrCreate('2026-08-03');
    day = await repo.patch(day.entry_id, day.revision, { weight_kg: 75 });
    const people = new Catalogs(sql, randomUUID, 'friends');
    const social = (await people.logs(day.entry_id))[0]!;
    await people.deselect(social);
    db.close(); db = new DatabaseSync(path); sql = adapter(db);
    const replay = await importV1(sql, raw, crypto, { dryRun: false });
    assert.equal(replay.insertedRecords, 0); assert.equal(replay.archivedSourceRows, 0);
    repo = new DailyEntries(sql, randomUUID); assert.deepEqual(await repo.getOrCreate('2026-08-03'), day);
    assert.equal(db.prepare('SELECT included FROM social_logs WHERE social_log_id = ?').get(social.id)!.included, 0);
    assert.equal(db.prepare('SELECT note FROM social_logs WHERE social_log_id = ?').get(social.id)!.note, 'Note fictive');
    const newer = fixture(); newer.daily_entries!.push({ entry_date: '2026-08-05', weight_kg: 74, updated_at: stamp });
    await importV1(sql, await bundle(newer), crypto, { dryRun: false });
    assert.equal(db.prepare('SELECT count(*) AS n FROM daily_entries').get()!.n, 3);
    assert.equal(db.prepare('SELECT count(*) AS n FROM sport_sessions').get()!.n, 2);
    assert.equal((await repo.getOrCreate('2026-08-03')).weight_kg, 75);
    const saved = await captureSnapshot(sql, migrations);
    const restored = new DatabaseSync(':memory:');
    try {
      await migrate(adapter(restored), migrations); await restoreSnapshot(adapter(restored), JSON.stringify(saved), migrations);
      assert.equal((await importV1(adapter(restored), raw, crypto, { dryRun: false })).insertedRecords, 0);
      assert.equal(restored.prepare('SELECT included FROM social_logs WHERE social_log_id = ?').get(social.id)!.included, 0);
      assert.equal(restored.prepare('SELECT count(*) AS n FROM v1_import_archive').get()!.n, db.prepare('SELECT count(*) AS n FROM v1_import_archive').get()!.n);
    } finally { restored.close(); }
  } finally { db.close(); rmSync(folder, { recursive: true }); }
});

test('collision, missing relation, interrupted SQL and modified V1 source leave the destination unchanged', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const sql = adapter(db); await migrate(sql, migrations);
    const raw = await bundle();
    db.exec("CREATE TRIGGER synthetic_abort BEFORE INSERT ON social_logs BEGIN SELECT RAISE(ABORT, 'synthetic interruption'); END");
    await assert.rejects(importV1(sql, raw, crypto, { dryRun: false }));
    assert.equal(db.prepare('SELECT count(*) AS n FROM daily_entries').get()!.n, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM v1_import_archive').get()!.n, 0);
    db.exec('DROP TRIGGER synthetic_abort');
    const missing = fixture(); missing.social_logs![0]!.friend_id = 999;
    await assert.rejects(importV1(sql, await bundle(missing), crypto, { dryRun: false }));
    assert.equal(db.prepare('SELECT count(*) AS n FROM daily_entries').get()!.n, 0);
    const day = await new DailyEntries(sql, randomUUID).getOrCreate('2026-08-03');
    await assert.rejects(importV1(sql, raw, crypto, { dryRun: false }), /journée V2/);
    assert.equal((await new DailyEntries(sql, randomUUID).getOrCreate(day.entry_date)).revision, day.revision);
    db.prepare('DELETE FROM daily_entries WHERE entry_id = ?').run(day.entry_id); // Synthetic test fixture only.
    await importV1(sql, raw, crypto, { dryRun: false });
    const before = (await captureSnapshot(sql, migrations)).tables;
    const changed = fixture(); changed.daily_entries![0]!.weight_kg = 82;
    await assert.rejects(importV1(sql, await bundle(changed), crypto, { dryRun: false }), /Conflit/);
    assert.deepEqual((await captureSnapshot(sql, migrations)).tables, before);
  } finally { db.close(); }
});

test('legacy progression versions and malformed source/manifest are handled explicitly', async () => {
  for (const [version, max] of [[1,10],[2,9],[3,10],[4,11],[5,12]]) {
    const progress = convertV1Progress({ version: version!, completed_steps: JSON.stringify(Array.from({ length: max! + 1 }, (_, i) => i)), skipped_steps: '[]' });
    assert.equal(progress.checkin_finished, 1);
    assert.equal(JSON.parse(progress.completed_steps).length + JSON.parse(progress.skipped_steps).length, 13);
  }
  assert.throws(() => convertV1Progress({ version: 6 }));
  assert.throws(() => convertV1Progress({ version: 1, completed_steps: '[12]' }));
  const partial = convertV1Progress({ version: 1, completed_steps: '[0,6]', skipped_steps: '[7]' });
  assert.deepEqual(JSON.parse(partial.completed_steps), ['sleep']);
  assert.deepEqual(JSON.parse(partial.skipped_steps), ['sport', 'me-time', 'listening']);
  assert.deepEqual(convertV1Progress({ version: null, completed_steps: '[0,6]', skipped_steps: '[7]' }), partial);
  const db = new DatabaseSync(':memory:');
  try {
    const sql = adapter(db); await migrate(sql, migrations);
    const raw = JSON.parse(await bundle()); raw.tables.daily_entries.rows[0].weight_kg = 99;
    await assert.rejects(importV1(sql, JSON.stringify(raw), crypto, { dryRun: false }), /Contrôle/);
    const unknown = fixture(); unknown.daily_entries![0]!.unknown_field = 'must not disappear';
    await assert.rejects(importV1(sql, await bundle(unknown), crypto, { dryRun: false }), /inconnue/);
    const invalid = fixture(); invalid.daily_entries![0]!.entry_date = '2026-02-30';
    await assert.rejects(importV1(sql, await bundle(invalid), crypto, { dryRun: false }));
    assert.equal(db.prepare('SELECT count(*) AS n FROM v1_import_runs').get()!.n, 0);
  } finally { db.close(); }
});

test('snapshot packer uses only the explicit synthetic folder, filters secrets and refuses overwrite/path escape', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'life-v1-pack-synthetic-'));
  try {
    const tables = fixture(), metadata: Record<string, unknown> = {};
    for (const table of v1Tables) {
      const rows = tables[table] ?? [];
      writeFileSync(join(folder, `${table}.json`), JSON.stringify(rows));
      metadata[table] = { present: true, rows: rows.length, file: `${table}.json`, columns: rows[0] ? Object.keys(rows[0]) : [] };
    }
    const manifest = { format_version: 1, created_at: stamp, tables: metadata };
    writeFileSync(join(folder, 'manifest.json'), JSON.stringify(manifest));
    const output = join(folder, 'synthetic.ldv1.json');
    const run = () => spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/package-v1-snapshot.mjs', '--snapshot', folder, '--output', output], { encoding: 'utf8' });
    assert.equal(run().status, 0);
    assert.ok(!readFileSync(output, 'utf8').includes('synthetic-secret-excluded'));
    assert.equal(JSON.parse(readFileSync(output, 'utf8')).excludedSettings, 1);
    const original = readFileSync(output, 'utf8'); assert.equal(run().status, 1); assert.equal(readFileSync(output, 'utf8'), original);
    (metadata.daily_entries as { file: string }).file = '../escape.json';
    writeFileSync(join(folder, 'manifest.json'), JSON.stringify(manifest));
    const escapedOutput = join(folder, 'escape.ldv1.json');
    const escaped = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/package-v1-snapshot.mjs', '--snapshot', folder, '--output', escapedOutput], { encoding: 'utf8' });
    assert.equal(escaped.status, 1); assert.equal(existsSync(escapedOutput), false);
  } finally { rmSync(folder, { recursive: true }); }
});
