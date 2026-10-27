import type { BindValue, SqlConnection } from './migrations';
import type { CatalogKind } from './catalogs';
import { RevisionConflict } from './dailyEntries.ts';
import { WriteQueue } from './writeQueue.ts';

export interface JournalRecord {
  id: string; entry_id: string; subject_id: string; revision: number; note: string | null;
  context?: string; duration_minutes?: number | null; included?: number; worked?: number;
}
export type JournalPatch = { note?: string | null; context?: string; duration_minutes?: number | null };
const definitions = {
  friends: { table: 'social_logs', id: 'social_log_id', subject: 'friend_id', extra: 'context, duration_minutes, included' },
  goals: { table: 'goal_logs', id: 'goal_log_id', subject: 'goal_id', extra: 'worked' },
} as const;
export function validateJournalPatch(kind: CatalogKind, patch: JournalPatch): [string, BindValue][] {
  if (!Object.hasOwn(definitions, kind)) throw new Error('Type de journal inconnu');
  const result: [string, BindValue][] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (!['note', ...(kind === 'friends' ? ['context', 'duration_minutes'] : [])].includes(key)) throw new Error('Champ de journal inconnu');
    if (value === undefined) continue;
    if (key === 'note' && value !== null && (typeof value !== 'string' || value.length > 10000)) throw new Error('Note invalide');
    if (key === 'context' && (typeof value !== 'string' || !value.trim() || value.length > 10000)) throw new Error('Contexte invalide');
    if (key === 'duration_minutes' && value !== null && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 1440)) throw new Error('Durée sociale invalide');
    result.push([key, value]);
  }
  return result;
}
/** Edits only an existing log. Never selects a person, works a goal or creates a day. */
export class Journals {
  private readonly db: SqlConnection;
  readonly kind: CatalogKind;
  constructor(db: SqlConnection, kind: CatalogKind) {
    if (!Object.hasOwn(definitions, kind)) throw new Error('Type de journal inconnu');
    this.db = db; this.kind = kind;
  }
  private columns() {
    const def = definitions[this.kind];
    return `${def.id} AS id, entry_id, ${def.subject} AS subject_id, revision, note, ${def.extra}`;
  }
  async read(id: string): Promise<JournalRecord> {
    const row = await this.db.getFirstAsync<JournalRecord>(`SELECT ${this.columns()} FROM ${definitions[this.kind].table} WHERE ${definitions[this.kind].id} = ?`, id);
    if (!row) throw new Error('Journal absent. Aucun brouillon remplacé.');
    return row;
  }
  async patch(id: string, revision: number, patch: JournalPatch): Promise<JournalRecord> {
    if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Révision invalide');
    const fields = validateJournalPatch(this.kind, patch), def = definitions[this.kind];
    const row = fields.length
      ? await this.db.getFirstAsync<JournalRecord>(`UPDATE ${def.table} SET ${fields.map(([key]) => `${key} = ?`).join(', ')}, revision = revision + 1, updated_at = ? WHERE ${def.id} = ? AND revision = ? RETURNING ${this.columns()}`, ...fields.map(([, value]) => value), new Date().toISOString(), id, revision)
      : await this.db.getFirstAsync<JournalRecord>(`SELECT ${this.columns()} FROM ${def.table} WHERE ${def.id} = ? AND revision = ?`, id, revision);
    if (!row) throw new RevisionConflict();
    return row;
  }
}
export class JournalDraft extends WriteQueue<JournalRecord, JournalPatch> {
  constructor(repository: Journals, row: JournalRecord) {
    super(row, patch => Object.fromEntries(validateJournalPatch(repository.kind, patch)), (current, patch) => repository.patch(current.id, current.revision, patch));
  }
}
export async function resolveJournalDraft(repository: Journals, latest: JournalRecord, pending: JournalPatch, keepDraft: readonly string[]): Promise<JournalDraft> {
  validateJournalPatch(repository.kind, pending);
  if (keepDraft.some(key => !Object.hasOwn(pending, key)) || new Set(keepDraft).size !== keepDraft.length) throw new Error('Choix de résolution invalide');
  return new JournalDraft(repository, await repository.patch(latest.id, latest.revision, Object.fromEntries(keepDraft.map(key => [key, pending[key as keyof JournalPatch]]))));
}
