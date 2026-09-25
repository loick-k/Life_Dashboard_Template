import type { BindValue, SqlConnection } from './migrations';
import { RevisionConflict } from './dailyEntries.ts';

export const SPORT_TYPES = ['Course', 'Vélo', 'Musculation', 'Sport collectif', 'Escalade', 'Badminton', 'Autre'] as const;
export type SportPatch = { sport_type?: string | null; duration_minutes?: number | null; distance_km?: number | null };
export type SportSession = {
  session_id: string; entry_id: string; position: number; revision: number;
  sport_type: string | null; duration_minutes: number | null; distance_km: number | null;
};
function fields(patch: SportPatch): [string, BindValue][] {
  const result: [string, BindValue][] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (!['sport_type', 'duration_minutes', 'distance_km'].includes(key)) throw new Error('Champ sport inconnu');
    if (value === undefined) continue;
    if (value !== null) {
      if (key === 'sport_type') {
        if (!SPORT_TYPES.includes(value as typeof SPORT_TYPES[number])) throw new Error('Sport invalide');
      } else if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 ||
        (key === 'duration_minutes' ? !Number.isInteger(value) || value > 600 : value > 200)) throw new Error('Valeur sport invalide');
    }
    result.push([key, value]);
  }
  return result;
}

export class SportSessions {
  private db: SqlConnection;
  private uuid: () => string;
  constructor(db: SqlConnection, uuid: () => string) { this.db = db; this.uuid = uuid; }

  async getOrCreate(entryId: string, position: number): Promise<SportSession> {
    if (!Number.isInteger(position) || position < 1 || position > 3) throw new Error('Position invalide');
    const now = new Date().toISOString();
    await this.db.runAsync('INSERT INTO sport_sessions (session_id, entry_id, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(entry_id, position) DO NOTHING', this.uuid(), entryId, position, now, now);
    const row = await this.db.getFirstAsync<SportSession>('SELECT * FROM sport_sessions WHERE entry_id = ? AND position = ?', entryId, position);
    if (!row) throw new Error('Séance indisponible');
    return row;
  }

  async patch(id: string, revision: number, patch: SportPatch): Promise<SportSession> {
    if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Révision invalide');
    const values = fields(patch);
    const row = values.length ? await this.db.getFirstAsync<SportSession>(
      `UPDATE sport_sessions SET ${values.map(([key]) => `${key} = ?`).join(', ')}, revision = revision + 1, updated_at = ? WHERE session_id = ? AND revision = ? RETURNING *`,
      ...values.map(([, value]) => value), new Date().toISOString(), id, revision,
    ) : await this.db.getFirstAsync<SportSession>('SELECT * FROM sport_sessions WHERE session_id = ? AND revision = ?', id, revision);
    if (!row) throw new RevisionConflict();
    return row;
  }

  async delete(id: string, revision: number): Promise<void> {
    const result = await this.db.runAsync('DELETE FROM sport_sessions WHERE session_id = ? AND revision = ?', id, revision);
    if (result.changes !== 1) throw new RevisionConflict();
  }
}
