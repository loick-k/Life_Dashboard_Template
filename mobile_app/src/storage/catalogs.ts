import type { BindValue, SqlConnection } from './migrations';
import { RevisionConflict } from './dailyEntries.ts';

export interface QueryConnection extends SqlConnection {
  getAllAsync<T>(sql: string, ...params: BindValue[]): Promise<T[]>;
}
export type CatalogKind = 'friends' | 'goals';
export type CatalogItem = { id: string; label: string; active: number; revision: number; category: string | null };
export type LogItem = { id: string; entry_id: string; subject_id: string; revision: number; worked?: number };
export const FRIEND_CATEGORIES = ['Ami', 'Famille', 'Collègue', 'Association', 'Autre'];
const definitions = {
  friends: { id: 'friend_id', label: 'name', logs: 'social_logs', logId: 'social_log_id' },
  goals: { id: 'goal_id', label: 'title', logs: 'goal_logs', logId: 'goal_log_id' },
} as const;

/** Fixed schema identifiers only; values always bound. Histories survive archiving. */
export class Catalogs {
  private db: QueryConnection;
  private uuid: () => string;
  private kind: CatalogKind;
  constructor(db: QueryConnection, uuid: () => string, kind: CatalogKind) {
    if (!Object.hasOwn(definitions, kind)) throw new Error('Catalogue inconnu');
    this.db = db; this.uuid = uuid; this.kind = kind;
  }
  async list(activeOnly = true): Promise<CatalogItem[]> {
    const def = definitions[this.kind];
    return this.db.getAllAsync(`SELECT ${def.id} AS id, ${def.label} AS label, active, revision, ${this.kind === 'friends' ? 'category' : 'NULL'} AS category FROM ${this.kind} ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY ${def.label} COLLATE NOCASE, ${def.id}`);
  }
  async create(label: string, category = 'Ami'): Promise<string> {
    const value = label.trim();
    if (!value || value.length > 200 || !FRIEND_CATEGORIES.includes(category)) throw new Error('Nom ou catégorie invalide');
    const id = this.uuid(), now = new Date().toISOString(), def = definitions[this.kind];
    const result = this.kind === 'friends'
      ? await this.db.runAsync('INSERT INTO friends (friend_id, name, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', id, value, category, now, now)
      : await this.db.runAsync(`INSERT INTO goals (${def.id}, title, created_at, updated_at) SELECT ?, ?, ?, ? WHERE (SELECT count(*) FROM goals WHERE active = 1) < 3`, id, value, now, now);
    if (result.changes !== 1) throw new Error('Trois objectifs actifs sont déjà présents.');
    return id;
  }
  async setActive(item: CatalogItem, active: boolean): Promise<void> {
    const def = definitions[this.kind];
    const goalClause = this.kind === 'goals' ? ', completed_at = ?' : '';
    const now = new Date().toISOString();
    const params: BindValue[] = [active ? 1 : 0, now];
    if (this.kind === 'goals') params.push(active ? null : now);
    params.push(item.id, item.revision);
    const capacity = this.kind === 'goals' && active ? ' AND (SELECT count(*) FROM goals WHERE active = 1 AND goal_id <> ?) < 3' : '';
    if (capacity) params.push(item.id);
    const result = await this.db.runAsync(`UPDATE ${this.kind} SET active = ?, updated_at = ?, revision = revision + 1${goalClause} WHERE ${def.id} = ? AND revision = ?${capacity}`, ...params);
    if (result.changes !== 1) throw new RevisionConflict();
  }
  async logs(entryId: string): Promise<LogItem[]> {
    const def = definitions[this.kind];
    return this.db.getAllAsync(`SELECT ${def.logId} AS id, entry_id, ${def.id} AS subject_id, revision${this.kind === 'goals' ? ', worked' : ''} FROM ${def.logs} WHERE entry_id = ?`, entryId);
  }
  async select(entryId: string, subjectId: string): Promise<LogItem> {
    const def = definitions[this.kind], now = new Date().toISOString();
    await this.db.runAsync(`INSERT INTO ${def.logs} (${def.logId}, entry_id, ${def.id}, created_at, updated_at${this.kind === 'goals' ? ', worked' : ''}) VALUES (?, ?, ?, ?, ?${this.kind === 'goals' ? ', 1' : ''}) ON CONFLICT(entry_id, ${def.id}) DO NOTHING`, this.uuid(), entryId, subjectId, now, now);
    const row = await this.db.getFirstAsync<LogItem>(`SELECT ${def.logId} AS id, entry_id, ${def.id} AS subject_id, revision${this.kind === 'goals' ? ', worked' : ''} FROM ${def.logs} WHERE entry_id = ? AND ${def.id} = ?`, entryId, subjectId);
    if (!row) throw new Error('Journal indisponible');
    if (this.kind === 'goals' && row.worked === 0) {
      const changed = await this.db.getFirstAsync<LogItem>('UPDATE goal_logs SET worked = 1, revision = revision + 1, updated_at = ? WHERE goal_log_id = ? AND revision = ? RETURNING goal_log_id AS id, entry_id, goal_id AS subject_id, revision, worked', now, row.id, row.revision);
      if (!changed) throw new RevisionConflict();
      return changed;
    }
    return row;
  }
  async deselect(log: LogItem): Promise<void> {
    const def = definitions[this.kind];
    const result = await this.db.runAsync(`DELETE FROM ${def.logs} WHERE ${def.logId} = ? AND revision = ?`, log.id, log.revision);
    if (result.changes !== 1) throw new RevisionConflict();
  }
}
