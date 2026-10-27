import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import { createSecureOpener } from './secureOpening';
import { migrate } from './migrations';
import migrations from './generated/migrations.json';
import { keyProtection } from './nativeProtection';

const databaseName = 'life-dashboard-v2.db';
let authorizedKey: string | null | undefined;
let opening: Promise<SQLite.SQLiteDatabase> | undefined;

/** No plaintext fallback, including in Expo Go. Native SQLCipher build required. */
const openCachedDatabase = createSecureOpener<SQLite.SQLiteDatabase>({
  exists: async () => new File(SQLite.defaultDatabaseDirectory, databaseName).exists,
  readKey: async () => { if (authorizedKey === undefined) throw new Error('Authorization required'); return authorizedKey; },
  writeKey: key => keyProtection.initialize(key),
  randomKey: async () => Array.from(await Crypto.getRandomBytesAsync(32), byte => byte.toString(16).padStart(2, '0')).join(''),
  open: () => SQLite.openDatabaseAsync(databaseName),
  unlockAndCheck: async (database, key) => {
    // key is validated as exactly 64 hexadecimal characters by the coordinator.
    await database.execAsync(`PRAGMA key = "x'${key}'"`);
    const cipher = await database.getFirstAsync<{ cipher_version: string }>('PRAGMA cipher_version');
    if (!cipher?.cipher_version) throw new Error('SQLCipher required');
    // Forces page decryption before any schema changes; wrong keys must fail.
    await database.getFirstAsync('SELECT count(*) FROM sqlite_master');
    const integrity = await database.getFirstAsync<{ integrity_check: string }>('PRAGMA integrity_check');
    if (integrity?.integrity_check !== 'ok') throw new Error('Integrity check failed');
    await database.execAsync('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
    await migrate(database, migrations);
  },
  close: database => database.closeAsync(),
});

/** Authenticate even if a native connection is already cached (e.g. React remount). */
export function openLocalDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!opening) opening = (async () => {
    try {
      authorizedKey = await keyProtection.readKey();
      return await openCachedDatabase();
    } finally { authorizedKey = undefined; }
  })().finally(() => { opening = undefined; });
  return opening;
}
