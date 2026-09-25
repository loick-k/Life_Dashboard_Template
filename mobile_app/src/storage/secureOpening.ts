export interface SecureOpeningPorts<T> {
  exists(): Promise<boolean>;
  readKey(): Promise<string | null>;
  writeKey(key: string): Promise<void>;
  randomKey(): Promise<string>;
  open(): Promise<T>;
  unlockAndCheck(database: T, key: string): Promise<void>;
  close(database: T): Promise<void>;
}

export class StorageUnavailable extends Error {
  constructor() {
    super('Impossible d’ouvrir le stockage sécurisé. Vos fichiers sont conservés. Réessayez ou restaurez une sauvegarde.');
    this.name = 'StorageUnavailable';
  }
}

/** Single flight prevents simultaneous first launches creating different keys. */
export function createSecureOpener<T>(ports: SecureOpeningPorts<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  async function initialize(): Promise<T> {
    let database: T | undefined;
    try {
      const exists = await ports.exists();
      let key = await ports.readKey();
      if (key === null) {
        if (exists) throw new StorageUnavailable();
        key = await ports.randomKey();
        if (!/^[0-9a-f]{64}$/.test(key)) throw new StorageUnavailable();
        // Persist BEFORE creating the database, including across interruptions.
        await ports.writeKey(key);
      }
      if (!/^[0-9a-f]{64}$/.test(key)) throw new StorageUnavailable();
      database = await ports.open();
      await ports.unlockAndCheck(database, key);
      return database;
    } catch {
      if (database !== undefined) {
        try { await ports.close(database); } catch { /* Preserve original failure, no raw native errors. */ }
      }
      // Never delete the database, reset a key, or expose a SQLCipher error/key.
      throw new StorageUnavailable();
    }
  }
  return () => {
    if (!pending) pending = initialize().catch(error => { pending = undefined; throw error; });
    return pending;
  };
}
