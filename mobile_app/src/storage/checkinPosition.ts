import type { SqlConnection } from './migrations';
import { validateDate } from './dailyEntries.ts';
import { CHECKIN_SECTIONS } from '../domain/checkinConfig.ts';

export interface CheckinPosition { version: 1; step: string; revision: number }
export class CheckinPositionConflict extends Error {
  constructor() { super('La position de saisie a changé. Relis-la avant de poursuivre.'); }
}
const validStep = (step: string) => CHECKIN_SECTIONS.some(section => section.id === step);
function decode(value: string | null): CheckinPosition {
  const result = value === null ? null : JSON.parse(value) as CheckinPosition;
  if (!result || result.version !== 1 || !validStep(result.step) || !Number.isSafeInteger(result.revision) || result.revision < 1) {
    throw new Error('Position de saisie incompatible. Aucune donnée effacée.');
  }
  return result;
}

/** Cursor is independent of daily revisions: navigating cannot overwrite metrics. */
export class CheckinPositions {
  private database: SqlConnection;
  constructor(database: SqlConnection) { this.database = database; }
  private key(date: string) { validateDate(date); return `checkin.position:${date}`; }
  async read(date: string): Promise<CheckinPosition> {
    const key = this.key(date);
    await this.database.runAsync('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING',
      key, JSON.stringify({ version: 1, step: 'sleep', revision: 1 }), new Date().toISOString());
    const row = await this.database.getFirstAsync<{ value: string | null }>('SELECT value FROM settings WHERE key = ?', key);
    return decode(row?.value ?? null);
  }
  async move(date: string, revision: number, step: string): Promise<CheckinPosition> {
    const key = this.key(date);
    if (!validStep(step)) throw new Error('Étape inconnue.');
    const row = await this.database.getFirstAsync<{ value: string | null }>('SELECT value FROM settings WHERE key = ?', key);
    const previous = decode(row?.value ?? null);
    if (previous.revision !== revision) throw new CheckinPositionConflict();
    const next: CheckinPosition = { version: 1, step, revision: revision + 1 };
    const result = await this.database.runAsync('UPDATE settings SET value = ?, updated_at = ? WHERE key = ? AND value = ?',
      JSON.stringify(next), new Date().toISOString(), key, row!.value);
    if (result.changes !== 1) throw new CheckinPositionConflict();
    return next;
  }
}
