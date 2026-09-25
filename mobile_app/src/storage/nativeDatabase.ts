import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import { createSecureOpener } from './secureOpening';
import { migrate } from './migrations';
import migrations from './generated/migrations.json';

const databaseName = 'life-dashboard-v2.db';
const keyName = 'life-dashboard.database-key.v1';

/** No plaintext fallback, including in Expo Go. Native SQLCipher build required. */
export const openLocalDatabase = createSecureOpener<SQLite.SQLiteDatabase>({
  exists: async () => new File(SQLite.defaultDatabaseDirectory, databaseName).exists,
  readKey: () => SecureStore.getItemAsync(keyName),
  writeKey: key => SecureStore.setItemAsync(keyName, key),
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
