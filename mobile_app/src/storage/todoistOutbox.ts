import type { SqlConnection } from './migrations';
import { commandFor, uuid, type TodoistAction } from '../integrations/todoistCommands.ts';
import { object, todoistId, TodoistError } from '../integrations/todoistTypes.ts';

const key = 'integration.todoist.pending.v1'; // Device-only settings key, excluded by backup's portable allowlist.
export interface PendingTodoist {
  version: 1; owner: string; id: string; temporaryId?: string; action: TodoistAction;
  state: 'prepared' | 'rejected' | 'acknowledged'; createdAt: string;
}
function decode(raw: string): PendingTodoist {
  try {
    if (raw.length > 20000) throw new Error();
    const data = object(JSON.parse(raw));
    if (Object.keys(data).some(key => !['version', 'owner', 'id', 'temporaryId', 'action', 'state', 'createdAt'].includes(key)) || data.version !== 1 || !['prepared', 'rejected', 'acknowledged'].includes(String(data.state)) || typeof data.createdAt !== 'string' || !Number.isFinite(new Date(data.createdAt).valueOf())) throw new Error();
    todoistId(data.owner); uuid(data.id); commandFor(data.action as TodoistAction, String(data.id), data.temporaryId as string | undefined);
    return data as unknown as PendingTodoist;
  } catch { throw new TodoistError('configuration'); }
}
/** Exactly one immutable pending command, persisted before sending anything externally. */
export class TodoistOutbox {
  private readonly db: SqlConnection; private readonly uuid: () => string;
  constructor(db: SqlConnection, uuid: () => string) { this.db = db; this.uuid = uuid; }
  private async stored() {
    const row = await this.db.getFirstAsync<{ value: string | null }>('SELECT value FROM settings WHERE key = ?', key);
    if (!row) return null;
    if (typeof row.value !== 'string') throw new TodoistError('configuration');
    return { raw: row.value, value: decode(row.value) };
  }
  async get(): Promise<PendingTodoist | null> { return (await this.stored())?.value ?? null; }
  async prepare(owner: string, action: TodoistAction): Promise<PendingTodoist> {
    const pending: PendingTodoist = { version: 1, owner: todoistId(owner), id: uuid(this.uuid()), ...(action.kind === 'task.add' || action.kind === 'project.add' ? { temporaryId: uuid(this.uuid()) } : {}), action, state: 'prepared', createdAt: new Date().toISOString() };
    const raw = JSON.stringify(pending); decode(raw);
    const result = await this.db.runAsync('INSERT INTO settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO NOTHING', key, raw, pending.createdAt);
    if (result.changes !== 1) throw new TodoistError('pending');
    return decode(raw);
  }
  async mark(id: string, state: PendingTodoist['state']): Promise<void> {
    const current = await this.stored(); if (!current || current.value.id !== id) throw new TodoistError('pending');
    if (!['prepared', 'rejected', 'acknowledged'].includes(state) || current.value.state !== 'prepared' && current.value.state !== state) throw new TodoistError('pending');
    const result = await this.db.runAsync('UPDATE settings SET value=?,updated_at=? WHERE key=? AND value=?', JSON.stringify({ ...current.value, state }), new Date().toISOString(), key, current.raw);
    if (result.changes !== 1) throw new TodoistError('pending');
  }
  async clear(id: string): Promise<void> {
    const current = await this.stored(); if (!current || current.value.id !== id) throw new TodoistError('pending');
    const result = await this.db.runAsync('DELETE FROM settings WHERE key=? AND value=?', key, current.raw);
    if (result.changes !== 1) throw new TodoistError('pending');
  }
}
