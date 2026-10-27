import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate, type BindValue } from '../src/storage/migrations.ts';
import type { QueryConnection } from '../src/storage/catalogs.ts';
import { DailyEntries } from '../src/storage/dailyEntries.ts';
import { SportSessions } from '../src/storage/sportSessions.ts';
import { Catalogs } from '../src/storage/catalogs.ts';
import { Preferences } from '../src/storage/preferences.ts';
import { CheckinPositions } from '../src/storage/checkinPosition.ts';
import { captureSnapshot, restoreSnapshot, type BackupSnapshot } from '../src/storage/backupSnapshot.ts';
import { openBackup, sealBackup, recoveryKey, type BackupCrypto } from '../src/storage/backupFormat.ts';
import { createBackup, restoreBackup, type BackupEnvironment } from '../src/storage/backupService.ts';

const migrations = JSON.parse(readFileSync('src/storage/generated/migrations.json', 'utf8'));
function adapter(db: DatabaseSync): QueryConnection {
  return {
    execAsync: async sql => { db.exec(sql); },
    getFirstAsync: async <T>(sql: string, ...params: BindValue[]) => (db.prepare(sql).get(...params) as T) ?? null,
    getAllAsync: async <T>(sql: string, ...params: BindValue[]) => db.prepare(sql).all(...params) as T[],
    runAsync: async (sql, ...params) => ({ changes: Number(db.prepare(sql).run(...params).changes) }),
  };
}
// Real authenticated AES, not a mock cipher. Native Expo port still needs Android validation.
const crypto: BackupCrypto = {
  randomKey: async () => randomBytes(32).toString('hex'),
  encrypt: async (plaintext, key, aad) => {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
    cipher.setAAD(aad);
    return Buffer.concat([iv, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]).toString('base64');
  },
  decrypt: async (combined, key, aad) => {
    const bytes = Buffer.from(combined, 'base64');
    const cipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), bytes.subarray(0, 12));
    cipher.setAAD(aad); cipher.setAuthTag(bytes.subarray(-16));
    return Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]);
  },
  sha256: async value => createHash('sha256').update(value).digest('hex'),
};
async function seed(sql: QueryConnection) {
  await migrate(sql, migrations);
  await sql.runAsync('INSERT INTO local_profile VALUES (?, ?, ?, ?, ?)', randomUUID(), 'Profil synthétique', 'Europe/Paris', '2026-10-27', '2026-10-27');
  const entries = new DailyEntries(sql, randomUUID);
  const day = await entries.getOrCreate('2026-10-26');
  await entries.patch(day.entry_id, day.revision, { weight_kg: 73.4, body_fat_pct: 0, work_start_time: '08:17', work_third_start_time: '18:13', meal_lunch: 'Repas fictif : été 🥗' });
  const sports = new SportSessions(sql, randomUUID), sport = await sports.getOrCreate(day.entry_id, 1);
  await sports.patch(sport.session_id, sport.revision, { distance_km: 0 });
  const friends = new Catalogs(sql, randomUUID, 'friends');
  await friends.select(day.entry_id, await friends.create('Relation synthétique', 'Ami'));
  await friends.setActive((await friends.list())[0]!, false);
  await sql.runAsync('UPDATE social_logs SET note = ?, duration_minutes = 0', 'Note synthétique');
  const goals = new Catalogs(sql, randomUUID, 'goals');
  await goals.select(day.entry_id, await goals.create('Objectif synthétique'));
  await new Preferences(sql).set('phone_max_hours', 0, 0);
  await new CheckinPositions(sql).read(day.entry_date);
  await new CheckinPositions(sql).move(day.entry_date, 1, 'work');
  await sql.runAsync('INSERT INTO settings VALUES (?, ?, ?)', 'integration.secret', 'synthetic-secret-excluded', '2026-10-27');
  await sql.runAsync('INSERT INTO settings VALUES (?, ?, ?)', 'onboarding.v1', 'synthetic-device-state', '2026-10-27');
}
async function verifyTemporary(snapshot: string) {
  const db = new DatabaseSync(':memory:');
  try { const sql = adapter(db); await migrate(sql, migrations); await restoreSnapshot(sql, snapshot, migrations); }
  finally { db.close(); }
}
const comparable = (snapshot: BackupSnapshot) => snapshot.tables;

test('backups predating the V1 journal upgrade restore through the known additive migration', async () => {
  const old = new DatabaseSync(':memory:'), current = new DatabaseSync(':memory:');
  try {
    const src = adapter(old), dst = adapter(current);
    await migrate(src, migrations.slice(0, 3));
    const day = await new DailyEntries(src, randomUUID).getOrCreate('2026-08-01');
    await new DailyEntries(src, randomUUID).patch(day.entry_id, day.revision, { weight_kg: 71 });
    // Build the exact historical snapshot shape from before migration 004.
    const tables: Record<string, unknown> = {};
    for (const table of ['local_profile','friends','goals','daily_entries','sport_sessions','social_logs','goal_logs','settings']) tables[table] = await src.getAllAsync(`SELECT * FROM ${table}`);
    const snapshot = { format: 'life-dashboard-snapshot', version: 1, createdAt: new Date().toISOString(), migrations: migrations.slice(0,3).map((item: { id: string; checksum: string }) => ({ id: item.id, checksum: item.checksum })), tables };
    await migrate(dst, migrations); await restoreSnapshot(dst, JSON.stringify(snapshot), migrations);
    assert.equal((await new DailyEntries(dst, randomUUID).getOrCreate(day.entry_date)).weight_kg, 71);
    assert.equal(current.prepare('SELECT count(*) AS n FROM v1_import_archive').get()!.n, 0);
  } finally { old.close(); current.close(); }
});

test('encrypted portable copy restores every value/relationship after reopen, without source secrets or device state', async () => {
  const source = new DatabaseSync(':memory:');
  const folder = mkdtempSync(join(tmpdir(), 'life-backup-synthetic-'));
  let target = new DatabaseSync(join(folder, 'restored.db'));
  try {
    const src = adapter(source); await seed(src);
    const captured = await captureSnapshot(src, migrations);
    assert.ok(!JSON.stringify(captured).includes('synthetic-secret-excluded'));
    assert.ok(!JSON.stringify(captured).includes('synthetic-device-state'));
    const key = await crypto.randomKey();
    const encrypted = await sealBackup(JSON.stringify(captured), key, crypto);
    assert.ok(!encrypted.includes('73.4') && !encrypted.includes('Repas fictif'));
    let dst = adapter(target); await migrate(dst, migrations);
    await dst.runAsync('INSERT INTO settings VALUES (?, ?, ?)', 'onboarding.v1', 'target-device-state', '2026-10-27');
    await restoreBackup(dst, migrations, encrypted, key, { crypto, verifyInTemporaryDatabase: verifyTemporary });
    assert.deepEqual(comparable(await captureSnapshot(dst, migrations)), comparable(captured));
    assert.equal((await dst.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', 'onboarding.v1'))!.value, 'target-device-state');
    target.close(); target = new DatabaseSync(join(folder, 'restored.db')); dst = adapter(target);
    assert.deepEqual(comparable(await captureSnapshot(dst, migrations)), comparable(captured));
    const day = await new DailyEntries(dst, randomUUID).getOrCreate('2026-10-26');
    assert.equal(day.work_start_time, '08:17'); assert.equal(day.work_morning_end_time, null);
    assert.equal(day.work_third_start_time, '18:13'); assert.equal(day.work_third_end_time, null);
    assert.equal(day.body_fat_pct, 0); assert.equal(day.meal_lunch, 'Repas fictif : été 🥗');
  } finally { source.close(); target.close(); rmSync(folder, { recursive: true }); }
});

test('wrong recovery key, altered ciphertext, tag, IV, header and truncation are refused before restoring', async () => {
  const key = await crypto.randomKey();
  const encrypted = await sealBackup('Données synthétiques 🥗', key, crypto);
  assert.equal(await openBackup(encrypted, key, crypto), 'Données synthétiques 🥗');
  assert.notEqual(await sealBackup('Données synthétiques 🥗', key, crypto), encrypted);
  await assert.rejects(openBackup(encrypted, await crypto.randomKey(), crypto));
  const envelope = JSON.parse(encrypted);
  for (const index of [0, 12, Buffer.from(envelope.sealed, 'base64').length - 1]) {
    const bytes = Buffer.from(envelope.sealed, 'base64'); bytes[index] = bytes[index]! ^ 1;
    await assert.rejects(openBackup(JSON.stringify({ ...envelope, sealed: bytes.toString('base64') }), key, crypto));
  }
  for (const bad of [encrypted.slice(0, -3), JSON.stringify({ ...envelope, version: 2 }), JSON.stringify({ ...envelope, algorithm: 'AES-CBC' })]) {
    await assert.rejects(openBackup(bad, key, crypto));
  }
  assert.throws(() => recoveryKey('password'));
  assert.equal(recoveryKey(key.toUpperCase().match(/.{1,8}/g)!.join('-')), key);
});

test('restore rollback preserves existing data on interrupted insert, foreign key error and incompatible settings', async () => {
  const source = new DatabaseSync(':memory:'), target = new DatabaseSync(':memory:');
  try {
    const src = adapter(source), dst = adapter(target); await seed(src); await seed(dst);
    const incoming = await captureSnapshot(src, migrations), original = await captureSnapshot(dst, migrations);
    target.exec("CREATE TRIGGER interrupt_restore BEFORE INSERT ON sport_sessions BEGIN SELECT RAISE(ABORT, 'synthetic interruption'); END");
    await assert.rejects(restoreSnapshot(dst, JSON.stringify(incoming), migrations));
    assert.deepEqual(comparable(await captureSnapshot(dst, migrations)), comparable(original));
    target.exec('DROP TRIGGER interrupt_restore');
    const badRelation = structuredClone(incoming); badRelation.tables.social_logs[0]!.friend_id = 'missing';
    const badSetting = structuredClone(incoming); badSetting.tables.settings.find(item => item.key === 'preference.v1:phone_max_hours')!.value = '{"version":2}';
    const secret = structuredClone(incoming); secret.tables.settings.push({ key: 'integration.secret', value: 'secret', updated_at: '2026-10-27' });
    const badColumn = structuredClone(incoming); badColumn.tables.daily_entries[0]!['unsafe;DROP TABLE friends'] = 'injected';
    for (const bad of [badRelation, badSetting, secret, badColumn]) {
      await assert.rejects(restoreSnapshot(dst, JSON.stringify(bad), migrations));
      assert.deepEqual(comparable(await captureSnapshot(dst, migrations)), comparable(original));
    }
  } finally { source.close(); target.close(); }
});

test('backup success is recorded only after test restore and file readback; cancellation/failure never reports success', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const sql = adapter(db); await seed(sql);
    const key = await crypto.randomKey(); let file = '', verified = false;
    const environment: BackupEnvironment = { crypto, uuid: randomUUID,
      verifyInTemporaryDatabase: async snapshot => { await verifyTemporary(snapshot); verified = true; },
      createDestination: async () => {
        assert.equal(verified, true);
        return { uri: 'synthetic://backup.ldbackup', write: async text => { file = text; }, read: async () => file };
      },
    };
    const result = await createBackup(sql, migrations, key, environment);
    assert.equal(result!.checksum, await crypto.sha256(file));
    assert.equal((await sql.getFirstAsync<{ n: number }>('SELECT count(*) AS n FROM backup_history'))!.n, 1);
    assert.equal(await createBackup(sql, migrations, key, { ...environment, createDestination: async () => null }), null);
    await assert.rejects(createBackup(sql, migrations, key, { ...environment, createDestination: async () => ({ uri: 'synthetic://bad', write: async () => {}, read: async () => 'truncated' }) }));
    await assert.rejects(createBackup(sql, migrations, key, { ...environment, verifyInTemporaryDatabase: async () => { throw new Error('failed test restore'); } }));
    assert.equal((await sql.getFirstAsync<{ n: number }>('SELECT count(*) AS n FROM backup_history'))!.n, 1);
  } finally { db.close(); }
});
