import { preferenceDefinition, preferenceDefinitions, validatePreference, type PreferenceKey, type PreferenceValue } from '../domain/preferences.ts';
import type { SqlConnection } from './migrations';

export interface PreferenceState { revision: number; value: PreferenceValue }
const prefix = 'preference.v1:';

function decode(key: PreferenceKey, encoded: string | null): PreferenceState {
  try {
    const state = JSON.parse(encoded ?? 'null');
    if (!state || state.version !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 1) throw new Error();
    const value = validatePreference(key, state.value);
    if (value !== state.value) throw new Error();
    return { revision: state.revision, value };
  } catch { throw new Error('Réglage illisible ou incompatible. Aucune réinitialisation effectuée.'); }
}

/** Independent CAS per key: reading defaults makes no writes; secrets are rejected. */
export class Preferences {
  private database: SqlConnection;
  constructor(database: SqlConnection) { this.database = database; }

  async read(key: PreferenceKey): Promise<PreferenceState> {
    const definition = preferenceDefinition(key);
    const row = await this.database.getFirstAsync<{ value: string | null }>('SELECT value FROM settings WHERE key = ?', prefix + key);
    return row ? decode(key, row.value) : { revision: 0, value: definition.initial };
  }

  async readAll(): Promise<Record<PreferenceKey, PreferenceState>> {
    return Object.fromEntries(await Promise.all(preferenceDefinitions.map(async ({ key }) => [key, await this.read(key)]))) as Record<PreferenceKey, PreferenceState>;
  }

  async set(key: PreferenceKey, revision: number, value: PreferenceValue): Promise<PreferenceState> {
    const normalized = validatePreference(key, value);
    if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) throw new Error('Révision invalide.');
    const storedKey = prefix + key;
    const row = await this.database.getFirstAsync<{ value: string | null }>('SELECT value FROM settings WHERE key = ?', storedKey);
    const current = row ? decode(key, row.value) : { revision: 0 };
    if (current.revision !== revision) throw new Error('Ce réglage a changé. Rechargez avant de continuer.');
    const next = { revision: revision + 1, value: normalized };
    const encoded = JSON.stringify({ version: 1, ...next });
    const now = new Date().toISOString();
    const result = row
      ? await this.database.runAsync('UPDATE settings SET value = ?, updated_at = ? WHERE key = ? AND value = ?', encoded, now, storedKey, row.value)
      : await this.database.runAsync('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING', storedKey, encoded, now);
    if (result.changes !== 1) throw new Error('Ce réglage a changé. Rechargez avant de continuer.');
    return next;
  }
}
