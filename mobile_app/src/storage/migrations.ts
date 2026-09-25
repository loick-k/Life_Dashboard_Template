export type BindValue = string | number | null;
export interface SqlConnection {
  execAsync(sql: string): Promise<void>;
  getFirstAsync<T>(sql: string, ...params: BindValue[]): Promise<T | null>;
  runAsync(sql: string, ...params: BindValue[]): Promise<{ changes: number }>;
}
export interface Migration { id: string; sql: string; checksum: string }

/** Called only during bootstrap, before the connection is exposed to repositories.
 * Keep the already-unlocked connection: Expo exclusive transactions create another.
 */
export async function migrate(database: SqlConnection, migrations: readonly Migration[]): Promise<void> {
  await database.execAsync('PRAGMA foreign_keys = ON');
  for (const migration of migrations) {
    await database.execAsync('BEGIN IMMEDIATE');
    try {
      await database.execAsync('CREATE TABLE IF NOT EXISTS schema_migrations (migration_id TEXT PRIMARY KEY, checksum_sha256 TEXT NOT NULL, applied_at TEXT NOT NULL)');
      const unknown = await database.getFirstAsync<{ count: number }>(
        `SELECT count(*) AS count FROM schema_migrations WHERE migration_id NOT IN (${migrations.map(() => '?').join(',')})`,
        ...migrations.map(item => item.id),
      );
      if (unknown?.count) throw new Error('Database created by a newer application');
      const stored = await database.getFirstAsync<{ checksum_sha256: string }>(
        'SELECT checksum_sha256 FROM schema_migrations WHERE migration_id = ?', migration.id,
      );
      if (stored && stored.checksum_sha256 !== migration.checksum) throw new Error('Migration checksum mismatch');
      if (!stored) {
        // SQL is bundled, immutable application code; never accept imported SQL here.
        await database.execAsync(migration.sql);
        if (await database.getFirstAsync('PRAGMA foreign_key_check')) throw new Error('Invalid relations');
        await database.runAsync('INSERT INTO schema_migrations VALUES (?, ?, ?)', migration.id, migration.checksum, new Date().toISOString());
      }
      await database.execAsync('COMMIT');
    } catch (error) {
      await database.execAsync('ROLLBACK');
      throw error;
    }
  }
  const integrity = await database.getFirstAsync<{ integrity_check: string }>('PRAGMA integrity_check');
  if (integrity?.integrity_check !== 'ok') throw new Error('Invalid database');
}
