import type { QueryConnection } from './catalogs';
import type { Migration } from './migrations';
import { captureSnapshot, restoreSnapshot } from './backupSnapshot.ts';
import { openBackup, sealBackup, type BackupCrypto } from './backupFormat.ts';

export interface BackupFile { uri: string; read(): Promise<string>; write(text: string): Promise<void> }
export interface BackupEnvironment {
  crypto: BackupCrypto;
  uuid(): string;
  verifyInTemporaryDatabase(snapshot: string): Promise<void>;
  createDestination(name: string): Promise<BackupFile | null>;
}
/** Screen owns navigation lock; service marks success only after file read-back and test restore. */
export async function createBackup(database: QueryConnection, migrations: readonly Migration[], key: string, environment: BackupEnvironment) {
  const snapshot = JSON.stringify(await captureSnapshot(database, migrations));
  const encrypted = await sealBackup(snapshot, key, environment.crypto);
  const decrypted = await openBackup(encrypted, key, environment.crypto);
  if (decrypted !== snapshot) throw new Error('Vérification du chiffrement échouée.');
  await environment.verifyInTemporaryDatabase(decrypted);
  const id = environment.uuid();
  const destination = await environment.createDestination(`life-dashboard-${new Date().toISOString().slice(0, 10)}-${id}.ldbackup`);
  if (!destination) return null;
  await destination.write(encrypted);
  const readBack = await destination.read();
  if (readBack !== encrypted) throw new Error('Écriture du fichier non confirmée.');
  const checksum = await environment.crypto.sha256(readBack);
  const createdAt = new Date().toISOString();
  await database.runAsync('INSERT INTO backup_history (backup_id, created_at, destination, encrypted, checksum_sha256, schema_version, status) VALUES (?, ?, ?, 1, ?, ?, ?)',
    id, createdAt, destination.uri, checksum, migrations.at(-1)!.id, 'verified');
  return { createdAt, checksum, uri: destination.uri };
}

export async function restoreBackup(database: QueryConnection, migrations: readonly Migration[], encrypted: string, key: string, environment: Pick<BackupEnvironment, 'crypto' | 'verifyInTemporaryDatabase'>) {
  const snapshot = await openBackup(encrypted, key, environment.crypto);
  await environment.verifyInTemporaryDatabase(snapshot);
  return restoreSnapshot(database, snapshot, migrations);
}
