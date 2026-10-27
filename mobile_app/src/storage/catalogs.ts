import type { BindValue, SqlConnection } from './migrations';
import { RevisionConflict } from './dailyEntries.ts';

export interface QueryConnection extends SqlConnection {
  getAllAsync<T>(sql: string, ...params: BindValue[]): Promise<T[]>;
}
export type CatalogKind = 'friends' | 'goals';
export type CatalogItem = { id: string; label: string; active: number; revision: number; category: string | null; completed_at: string | null };
export type LogItem = { id: string; entry_id: string; subject_id: string; revision: number; worked?: number; included?: number };
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
    return this.db.getAllAsync(`SELECT ${def.id} AS id, ${def.label} AS label, active, revision, ${this.kind === 'friends' ? 'category' : 'NULL'} AS category, ${this.kind === 'goals' ? 'completed_at' : 'NULL'} AS completed_at FROM ${this.kind} ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY ${def.label} COLLATE NOCASE, ${def.id}`);
  }
  async create(label: string, category = 'Ami'): Promise<string> {
    return this.createOnce(this.uuid(), label, category);
  }
  /** Caller persists id before invoking this operation. A retry verifies the
   * same row; it never deduplicates homonyms or changes an existing item. */
  async createOnce(id: string, label: string, category = 'Ami'): Promise<string> {
    const value = label.trim();
    if (typeof id !== 'string' || !/^[a-z\d-]{1,128}$/i.test(id) || !value || value.length > 200 || !FRIEND_CATEGORIES.includes(category)) throw new Error('Identifiant, nom ou catégorie invalide');
    const now = new Date().toISOString(), def = definitions[this.kind];
    const read = () => this.db.getFirstAsync<{ label: string; category: string | null }>(`SELECT ${def.label} AS label, ${this.kind === 'friends' ? 'category' : 'NULL'} AS category FROM ${this.kind} WHERE ${def.id} = ?`, id);
    let stored = await read();
    if (!stored) {
      if (this.kind === 'friends') await this.db.runAsync('INSERT INTO friends (friend_id, name, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(friend_id) DO NOTHING', id, value, category, now, now);
      else await this.db.runAsync(`INSERT INTO goals (${def.id}, title, created_at, updated_at) SELECT ?, ?, ?, ? WHERE (SELECT count(*) FROM goals WHERE active = 1) < 3 ON CONFLICT(goal_id) DO NOTHING`, id, value, now, now);
      stored = await read();
    }
    if (!stored) throw new Error('Trois objectifs actifs sont déjà présents ou ajout non confirmé.');
    if (stored.label !== value || this.kind === 'friends' && stored.category !== category) throw new Error('Cet identifiant existe avec un autre contenu. Aucun élément remplacé.');
    return id;
  }
  async setActive(item: CatalogItem, active: boolean): Promise<void> {
    const def = definitions[this.kind];
    if (this.kind === 'goals' && active && item.completed_at) throw new Error('Rouvre explicitement un objectif terminé.');
    const now = new Date().toISOString();
    const params: BindValue[] = [active ? 1 : 0, now];
    params.push(item.id, item.revision);
    const capacity = this.kind === 'goals' && active ? ' AND (SELECT count(*) FROM goals WHERE active = 1 AND goal_id <> ?) < 3' : '';
    if (capacity) params.push(item.id);
    const result = await this.db.runAsync(`UPDATE ${this.kind} SET active = ?, updated_at = ?, revision = revision + 1 WHERE ${def.id} = ? AND revision = ?${capacity}`, ...params);
    if (result.changes !== 1) throw new RevisionConflict();
  }
  async setCompleted(item: CatalogItem, completed: boolean): Promise<void> {
    if (this.kind !== 'goals') throw new Error('Seuls les objectifs peuvent être terminés.');
    const now = new Date().toISOString();
    const capacity = completed ? '' : ' AND (SELECT count(*) FROM goals WHERE active = 1 AND goal_id <> ?) < 3';
    const values: BindValue[] = [completed ? 0 : 1, completed ? item.completed_at ?? now : null, now, item.id, item.revision];
    if (!completed) values.push(item.id);
    const result = await this.db.runAsync(`UPDATE goals SET active = ?, completed_at = ?, updated_at = ?, revision = revision + 1 WHERE goal_id = ? AND revision = ?${capacity}`, ...values);
    if (result.changes !== 1) throw new RevisionConflict();
  }
  async logs(entryId: string, includeDeselected = false): Promise<LogItem[]> {
    const def = definitions[this.kind];
    return this.db.getAllAsync(`SELECT ${def.logId} AS id, entry_id, ${def.id} AS subject_id, revision${this.kind === 'goals' ? ', worked' : ', included'} FROM ${def.logs} WHERE entry_id = ?${this.kind === 'friends' && !includeDeselected ? ' AND included = 1' : ''}`, entryId);
  }
  async select(entryId: string, subjectId: string): Promise<LogItem> {
    const def = definitions[this.kind], now = new Date().toISOString();
    await this.db.runAsync(`INSERT INTO ${def.logs} (${def.logId}, entry_id, ${def.id}, created_at, updated_at${this.kind === 'goals' ? ', worked' : ''}) VALUES (?, ?, ?, ?, ?${this.kind === 'goals' ? ', 1' : ''}) ON CONFLICT(entry_id, ${def.id}) DO NOTHING`, this.uuid(), entryId, subjectId, now, now);
    const row = await this.db.getFirstAsync<LogItem>(`SELECT ${def.logId} AS id, entry_id, ${def.id} AS subject_id, revision${this.kind === 'goals' ? ', worked' : ', included'} FROM ${def.logs} WHERE entry_id = ? AND ${def.id} = ?`, entryId, subjectId);
    if (!row) throw new Error('Journal indisponible');
    if (this.kind === 'goals' && row.worked === 0) {
      const changed = await this.db.getFirstAsync<LogItem>('UPDATE goal_logs SET worked = 1, revision = revision + 1, updated_at = ? WHERE goal_log_id = ? AND revision = ? RETURNING goal_log_id AS id, entry_id, goal_id AS subject_id, revision, worked', now, row.id, row.revision);
      if (!changed) throw new RevisionConflict();
      return changed;
    }
    if (this.kind === 'friends' && row.included === 0) {
      const changed = await this.db.getFirstAsync<LogItem>('UPDATE social_logs SET included = 1, revision = revision + 1, updated_at = ? WHERE social_log_id = ? AND revision = ? RETURNING social_log_id AS id, entry_id, friend_id AS subject_id, revision, included', now, row.id, row.revision);
      if (!changed) throw new RevisionConflict();
      return changed;
    }
    return row;
  }
  async deselect(log: LogItem): Promise<void> {
    const def = definitions[this.kind];
    // Unchecking means "not worked", not "destroy this journal and its imported note".
    const result = this.kind === 'goals'
      ? await this.db.runAsync('UPDATE goal_logs SET worked = 0, revision = revision + 1, updated_at = ? WHERE goal_log_id = ? AND revision = ?', new Date().toISOString(), log.id, log.revision)
      : await this.db.runAsync('UPDATE social_logs SET included = 0, revision = revision + 1, updated_at = ? WHERE social_log_id = ? AND revision = ?', new Date().toISOString(), log.id, log.revision);
    if (result.changes !== 1) throw new RevisionConflict();
  }
}
