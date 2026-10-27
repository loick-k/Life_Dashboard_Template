import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import { Directory, File } from 'expo-file-system';
import { nativeBackupCrypto } from './nativeBackupCrypto';
import { MAX_BACKUP_BYTES } from './backupFormat';
import { migrate } from './migrations';
import migrations from './generated/migrations.json';
import { restoreSnapshot } from './backupSnapshot';
import type { BackupEnvironment } from './backupService';

export async function readBackupFile(file: File): Promise<string> {
  if (!file.exists || file.size < 1 || file.size > MAX_BACKUP_BYTES) throw new Error('Fichier absent ou trop volumineux.');
  const text = await file.text();
  if (text.length > MAX_BACKUP_BYTES) throw new Error('Fichier trop volumineux.');
  return text;
}

export const nativeBackupEnvironment: BackupEnvironment = {
  crypto: nativeBackupCrypto,
  uuid: Crypto.randomUUID,
  verifyInTemporaryDatabase: async snapshot => {
    const name = `backup-check-${Crypto.randomUUID()}.db`;
    if (new File(SQLite.defaultDatabaseDirectory, name).exists) throw new Error('Vérification temporaire indisponible.');
    let database: SQLite.SQLiteDatabase | undefined;
    try {
      const key = await nativeBackupCrypto.randomKey();
      database = await SQLite.openDatabaseAsync(name);
      await database.execAsync(`PRAGMA key = "x'${key}'"`);
      const cipher = await database.getFirstAsync<{ cipher_version: string }>('PRAGMA cipher_version');
      if (!cipher?.cipher_version) throw new Error('SQLCipher requis.');
      await database.execAsync('PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL;');
      await migrate(database, migrations);
      await restoreSnapshot(database, snapshot, migrations);
    } finally {
      try { if (database) await database.closeAsync(); }
      finally { if (new File(SQLite.defaultDatabaseDirectory, name).exists) await SQLite.deleteDatabaseAsync(name); }
    }
  },
  createDestination: async name => {
    // System folder picker grants access only to the chosen destination.
    const directory = await Directory.pickDirectoryAsync();
    const file = directory.createFile(name, 'application/octet-stream');
    return { uri: file.uri, write: async text => file.write(text), read: () => readBackupFile(file) };
  },
};
