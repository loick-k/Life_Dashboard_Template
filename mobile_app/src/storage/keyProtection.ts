export type ProtectionMode = 'device' | 'biometric' | 'enabling';
export interface KeyProtectionPorts {
  readPolicy(): Promise<string | null>;
  writePolicy(value: string): Promise<void>;
  readPlain(): Promise<string | null>;
  writePlain(key: string): Promise<void>;
  deletePlain(): Promise<void>;
  readProtected(): Promise<string | null>;
  writeProtected(key: string): Promise<void>;
  deleteProtected(): Promise<void>;
  canAuthenticate(): boolean;
}
export class ProtectionUnavailable extends Error {
  constructor() { super('Déverrouillage non confirmé. Les données sont conservées. Réessaie avec la biométrie configurée sur ce téléphone.'); }
}
function valid(key: string | null): string {
  if (!key || !/^[0-9a-f]{64}$/.test(key)) throw new ProtectionUnavailable();
  return key;
}

/** Policy and secrets stay on this device, outside SQLite and portable backups. */
export class KeyProtection {
  private busy = false;
  private readonly ports: KeyProtectionPorts;
  constructor(ports: KeyProtectionPorts) { this.ports = ports; }
  async mode(): Promise<ProtectionMode> {
    const raw = await this.ports.readPolicy();
    if (raw === null || raw === 'device:v1') return 'device';
    if (raw === 'biometric:v1') return 'biometric';
    if (raw === 'enabling:v1') return 'enabling';
    throw new ProtectionUnavailable(); // Unknown/corrupt policy never disables authentication.
  }
  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (this.busy) throw new ProtectionUnavailable();
    this.busy = true;
    try { return await action(); } catch { throw new ProtectionUnavailable(); }
    finally { this.busy = false; }
  }
  readKey(): Promise<string | null> {
    return this.exclusive(async () => {
      const mode = await this.mode();
      if (mode === 'device') {
        const key = await this.ports.readPlain();
        return key === null ? null : valid(key);
      }
      // Never fall back to the old key on cancellation, invalidation or interruption.
      const key = valid(await this.ports.readProtected());
      // Also completes an interrupted enable/disable transition, only after authentication.
      await this.ports.deletePlain();
      if (mode === 'enabling') await this.ports.writePolicy('biometric:v1');
      return key;
    });
  }
  initialize(key: string): Promise<void> {
    return this.exclusive(async () => {
      if (await this.mode() !== 'device' || await this.ports.readPlain() !== null) throw new ProtectionUnavailable();
      await this.ports.writePlain(valid(key));
    });
  }
  enable(): Promise<void> {
    return this.exclusive(async () => {
      if (await this.mode() !== 'device' || !this.ports.canAuthenticate()) throw new ProtectionUnavailable();
      const key = valid(await this.ports.readPlain());
      // Fresh Keystore service, authenticated write AND read-back before switching authority.
      await this.ports.writeProtected(key);
      if (valid(await this.ports.readProtected()) !== key) throw new ProtectionUnavailable();
      await this.ports.writePolicy('enabling:v1');
      await this.ports.deletePlain();
      await this.ports.writePolicy('biometric:v1');
    });
  }
  disable(): Promise<void> {
    return this.exclusive(async () => {
      if (await this.mode() === 'device') return;
      const key = valid(await this.ports.readProtected()); // Disabling requires authentication too.
      await this.ports.writePlain(key);
      if (await this.ports.readPlain() !== key) throw new ProtectionUnavailable();
      await this.ports.writePolicy('device:v1');
      await this.ports.deleteProtected();
    });
  }
}

/** An authentication completing after a background event must not reveal the app. */
export class UnlockGeneration {
  private generation = 0;
  invalidate(): void { this.generation++; }
  begin(): number { return this.generation; }
  accepts(token: number, active: boolean): boolean { return active && token === this.generation; }
}
