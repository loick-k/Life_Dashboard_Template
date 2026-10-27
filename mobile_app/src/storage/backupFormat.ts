export const BACKUP_AAD = 'LifeDashboard|backup|1|AES-256-GCM';
export const MAX_BACKUP_BYTES = 24 * 1024 * 1024;
export const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
export interface BackupCrypto {
  randomKey(): Promise<string>;
  encrypt(plaintext: Uint8Array, key: string, aad: Uint8Array): Promise<string>;
  decrypt(combinedBase64: string, key: string, aad: Uint8Array): Promise<Uint8Array>;
  sha256(value: string): Promise<string>;
}

/** Recovery code is a random 256-bit key, never a user password or the device DB key. */
export function recoveryKey(raw: string): string {
  const key = raw.replace(/[\s-]/g, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(key)) throw new Error('Le code de récupération doit contenir 64 caractères hexadécimaux.');
  return key;
}
export async function sealBackup(plaintext: string, rawKey: string, crypto: BackupCrypto): Promise<string> {
  const bytes = new TextEncoder().encode(plaintext);
  if (bytes.byteLength > MAX_SNAPSHOT_BYTES) throw new Error('Sauvegarde trop volumineuse pour cette version.');
  const sealed = await crypto.encrypt(bytes, recoveryKey(rawKey), new TextEncoder().encode(BACKUP_AAD));
  return JSON.stringify({ format: 'life-dashboard-backup', version: 1, algorithm: 'AES-256-GCM', sealed });
}
export async function openBackup(file: string, rawKey: string, crypto: BackupCrypto): Promise<string> {
  if (file.length > MAX_BACKUP_BYTES) throw new Error('Fichier trop volumineux.');
  const key = recoveryKey(rawKey);
  try {
    const envelope = JSON.parse(file);
    if (!envelope || envelope.format !== 'life-dashboard-backup' || envelope.version !== 1 || envelope.algorithm !== 'AES-256-GCM' ||
        Object.keys(envelope).sort().join(',') !== 'algorithm,format,sealed,version' || typeof envelope.sealed !== 'string' ||
        envelope.sealed.length < 40 || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.sealed)) throw new Error();
    const bytes = await crypto.decrypt(envelope.sealed, key, new TextEncoder().encode(BACKUP_AAD));
    if (bytes.byteLength > MAX_SNAPSHOT_BYTES) throw new Error();
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch { throw new Error('Sauvegarde incompatible, altérée ou code de récupération incorrect.'); }
}
