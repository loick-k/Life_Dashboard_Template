import type { QueryConnection } from './catalogs';
import type { BindValue, Migration } from './migrations';
import { dailyRules, validateDate, validatePatch, type DailyEntry } from './dailyEntries.ts';
import { readProgress } from './checkinProgress.ts';
import { Preferences } from './preferences.ts';
import { preferenceDefinitions } from '../domain/preferences.ts';
import { CHECKIN_SECTIONS } from '../domain/checkinConfig.ts';
import { MAX_SNAPSHOT_BYTES } from './backupFormat.ts';

export const backupTables = ['local_profile', 'friends', 'goals', 'daily_entries', 'sport_sessions', 'social_logs', 'goal_logs', 'settings'] as const;
type Table = typeof backupTables[number];
type Row = Record<string, BindValue>;
export interface BackupSnapshot {
  format: 'life-dashboard-snapshot'; version: 1; createdAt: string;
  migrations: { id: string; checksum: string }[];
  tables: Record<Table, Row[]>;
}
const preferences = new Set(preferenceDefinitions.map(item => `preference.v1:${item.key}`));
function portableKey(key: unknown): key is string {
  return typeof key === 'string' && (preferences.has(key) || /^checkin\.position:\d{4}-\d{2}-\d{2}$/.test(key));
}
function validateSetting(row: Row) {
  if (!portableKey(row.key)) throw new Error('Réglage non exportable.');
  if (row.key.startsWith('checkin.position:')) {
    validateDate(row.key.slice('checkin.position:'.length));
    const cursor = JSON.parse(String(row.value));
    if (!cursor || cursor.version !== 1 || !Number.isSafeInteger(cursor.revision) || cursor.revision < 1 ||
        !CHECKIN_SECTIONS.some(item => item.id === cursor.step)) throw new Error('Position incompatible.');
  }
}
async function checkSchema(database: QueryConnection, migrations: readonly Migration[]) {
  const journal = await database.getAllAsync<{ migration_id: string; checksum_sha256: string }>('SELECT migration_id, checksum_sha256 FROM schema_migrations ORDER BY migration_id');
  if (JSON.stringify(journal.map(item => ({ id: item.migration_id, checksum: item.checksum_sha256 }))) !==
      JSON.stringify(migrations.map(item => ({ id: item.id, checksum: item.checksum })))) throw new Error('Schéma incompatible.');
}

/** Logical copy under one transaction. Never copies credentials, lock or onboarding state. */
export async function captureSnapshot(database: QueryConnection, migrations: readonly Migration[]): Promise<BackupSnapshot> {
  await database.execAsync('BEGIN IMMEDIATE');
  try {
    await checkSchema(database, migrations);
    const tables = {} as BackupSnapshot['tables'];
    for (const table of backupTables) {
      const rows = await database.getAllAsync<Row>(`SELECT * FROM ${table}`);
      tables[table] = table === 'settings' ? rows.filter(row => portableKey(row.key)) : rows;
    }
    const result: BackupSnapshot = { format: 'life-dashboard-snapshot', version: 1, createdAt: new Date().toISOString(),
      migrations: migrations.map(item => ({ id: item.id, checksum: item.checksum })), tables };
    if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MAX_SNAPSHOT_BYTES) throw new Error('Sauvegarde trop volumineuse.');
    await database.execAsync('COMMIT');
    return result;
  } catch (error) { await database.execAsync('ROLLBACK'); throw error; }
}

function parseSnapshot(text: string, migrations: readonly Migration[]): BackupSnapshot {
  if (new TextEncoder().encode(text).byteLength > MAX_SNAPSHOT_BYTES) throw new Error('Sauvegarde trop volumineuse.');
  const snapshot = JSON.parse(text) as BackupSnapshot;
  if (!snapshot || snapshot.format !== 'life-dashboard-snapshot' || snapshot.version !== 1 ||
      typeof snapshot.createdAt !== 'string' || !Number.isFinite(Date.parse(snapshot.createdAt)) ||
      JSON.stringify(snapshot.migrations) !== JSON.stringify(migrations.map(item => ({ id: item.id, checksum: item.checksum }))) ||
      !snapshot.tables || Object.keys(snapshot.tables).sort().join(',') !== [...backupTables].sort().join(',')) throw new Error('Sauvegarde incompatible.');
  let count = 0;
  for (const table of backupTables) {
    const rows = snapshot.tables[table];
    if (!Array.isArray(rows)) throw new Error('Table illisible.');
    count += rows.length;
    if (count > 100000) throw new Error('Sauvegarde trop volumineuse.');
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row) || Object.values(row).some(value =>
        value !== null && typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value)))) throw new Error('Ligne illisible.');
      if (table === 'settings') validateSetting(row);
      if (table === 'daily_entries') {
        validateDate(String(row.entry_date));
        validatePatch(Object.fromEntries(Object.entries(row).filter(([name]) => Object.hasOwn(dailyRules, name))));
        const progress = readProgress(row as DailyEntry);
        if (row.checkin_finished === 1 && progress.count !== 13) throw new Error('Progression incohérente.');
        if (row.checkin_version !== 5) throw new Error('Version de saisie incompatible.');
      }
    }
  }
  return snapshot;
}

/** Replaces only portable data; transaction rollback preserves existing data on any failure.
 * Called from a dedicated route after all editors are flushed/unmounted and explicit confirmation.
 */
export async function restoreSnapshot(database: QueryConnection, text: string, migrations: readonly Migration[]) {
  const snapshot = parseSnapshot(text, migrations);
  // Column identifiers come from the local schema, never from the backup's keys.
  const columns = new Map<Table, string[]>();
  for (const table of backupTables) {
    const info = await database.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
    const names = info.map(item => item.name);
    if (!names.length || names.some(name => !/^[a-z_]+$/.test(name))) throw new Error('Schéma local invalide.');
    for (const row of snapshot.tables[table]) if (Object.keys(row).sort().join(',') !== [...names].sort().join(',')) throw new Error('Colonnes incompatibles.');
    columns.set(table, names);
  }
  await database.execAsync('BEGIN IMMEDIATE');
  try {
    await checkSchema(database, migrations);
    for (const table of [...backupTables].reverse()) {
      if (table === 'settings') {
        const keys = await database.getAllAsync<{ key: string }>('SELECT key FROM settings');
        for (const { key } of keys) if (portableKey(key)) await database.runAsync('DELETE FROM settings WHERE key = ?', key);
      } else await database.runAsync(`DELETE FROM ${table}`);
    }
    for (const table of backupTables) {
      const names = columns.get(table)!;
      for (const row of snapshot.tables[table]) await database.runAsync(
        `INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`, ...names.map(name => row[name]!));
    }
    await new Preferences(database).readAll(); // Validate portable values, including future-version refusal.
    if (await database.getFirstAsync('PRAGMA foreign_key_check')) throw new Error('Relations invalides.');
    const integrity = await database.getFirstAsync<{ integrity_check: string }>('PRAGMA integrity_check');
    if (integrity?.integrity_check !== 'ok') throw new Error('Intégrité invalide.');
    // Compare every restored value (not only row counts), independent of SQLite row ordering.
    for (const table of backupTables) {
      const rows = await database.getAllAsync<Row>(`SELECT * FROM ${table}`);
      const normalize = (items: Row[]) => items.map(row => JSON.stringify(columns.get(table)!.map(name => row[name]))).sort();
      if (JSON.stringify(normalize(table === 'settings' ? rows.filter(row => portableKey(row.key)) : rows)) !==
          JSON.stringify(normalize(snapshot.tables[table]))) throw new Error('Vérification de restauration échouée.');
    }
    await database.execAsync('COMMIT');
    return { createdAt: snapshot.createdAt, rows: backupTables.reduce((count, table) => count + snapshot.tables[table].length, 0) };
  } catch (error) { await database.execAsync('ROLLBACK'); throw error; }
}
