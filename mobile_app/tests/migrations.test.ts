import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { migrate, type SqlConnection, type Migration, type BindValue } from '../src/storage/migrations.ts';

const migrations: Migration[] = JSON.parse(readFileSync('src/storage/generated/migrations.json', 'utf8'));
function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  const connection: SqlConnection = {
    execAsync: async sql => { sqlite.exec(sql); },
    getFirstAsync: async <T>(sql: string, ...params: BindValue[]) => (sqlite.prepare(sql).get(...params) as T) ?? null,
    runAsync: async (sql, ...params) => ({ changes: Number(sqlite.prepare(sql).run(...params).changes) }),
  };
  return { sqlite, connection };
}

test('real SQLite creates all tables and replay preserves data', async () => {
  const { sqlite, connection } = fixture();
  try {
    await migrate(connection, migrations);
    sqlite.exec("INSERT INTO settings VALUES ('test', 'kept', '2026-01-01')");
    await migrate(connection, migrations);
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM schema_migrations').get()?.n, migrations.length);
    assert.equal(sqlite.prepare('SELECT value FROM settings').get()?.value, 'kept');
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get()?.n, 10);
  } finally { sqlite.close(); }
});

test('journal failure rolls schema back and retry succeeds', async () => {
  const { sqlite, connection } = fixture();
  const run = connection.runAsync;
  connection.runAsync = async () => { throw new Error('simulated write failure'); };
  try {
    await assert.rejects(migrate(connection, migrations));
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get()?.n, 0);
    connection.runAsync = run;
    await migrate(connection, migrations);
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM schema_migrations').get()?.n, 1);
  } finally { sqlite.close(); }
});

test('changed migration is rejected without changing stored data', async () => {
  const { sqlite, connection } = fixture();
  try {
    await migrate(connection, migrations);
    await assert.rejects(migrate(connection, migrations.map(m => ({ ...m, checksum: 'changed' }))));
    assert.equal(sqlite.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
  } finally { sqlite.close(); }
});

test('older app refuses a future schema without deleting its journal', async () => {
  const { sqlite, connection } = fixture();
  try {
    await migrate(connection, migrations);
    sqlite.exec("INSERT INTO schema_migrations VALUES ('999_future', 'future', '2026-01-01')");
    await assert.rejects(migrate(connection, migrations), /newer application/);
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM schema_migrations').get()?.n, 2);
  } finally { sqlite.close(); }
});
