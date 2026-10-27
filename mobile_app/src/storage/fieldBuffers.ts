import type { SqlConnection } from './migrations';

export type RawFieldBuffer = { value: string } | { hours: string; minutes: string };
export type FieldBuffer = { version: 1; token: string; raw: RawFieldBuffer; clear: boolean };
export type BufferKind = 'scalar' | 'duration';
export type BufferInputs<F extends string> = Partial<Record<F, { raw: RawFieldBuffer; clear?: boolean }>>;
export type BufferRecords<F extends string> = Partial<Record<F, FieldBuffer>>;

export function validateFieldBuffer(kind: BufferKind, value: unknown): FieldBuffer {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Brouillon illisible.');
  const item = value as FieldBuffer;
  if (Object.keys(item).sort().join(',') !== 'clear,raw,token,version' || item.version !== 1 || typeof item.clear !== 'boolean' ||
      typeof item.token !== 'string' || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(item.token) ||
      !item.raw || typeof item.raw !== 'object' || Array.isArray(item.raw) ||
      Object.values(item.raw).some(text => typeof text !== 'string' || text.length > 10000) ||
      Object.keys(item.raw).sort().join(',') !== (kind === 'duration' ? 'hours,minutes' : 'value') ||
      item.clear && Object.values(item.raw).some(text => text !== '')) throw new Error('Brouillon incompatible.');
  return item;
}

/** One private row per editor. A multi-field intent (e.g. removing a sport) is
 * staged atomically before its business write. No implicit replay or rebasing.
 * Field tokens ensure a late cleanup cannot remove a newer edit of that field.
 */
export class FieldBuffers<F extends string> {
  private readonly db: SqlConnection;
  private readonly key: string;
  private readonly kinds: Record<F, BufferKind>;
  private readonly uuid: () => string;
  private fields: BufferRecords<F> = {};
  private encoded: string | null = null;
  private loaded = false;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(db: SqlConnection, namespace: string, scope: string, kinds: Record<F, BufferKind>, uuid: () => string) {
    if (!/^[a-z][a-z.-]{0,50}$/.test(namespace) || !/^[a-z\d-]{1,128}$/i.test(scope) || !Object.keys(kinds).length ||
        Object.entries(kinds).some(([key, kind]) => !/^[a-z][a-z_]*$/.test(key) || !['scalar', 'duration'].includes(String(kind)))) throw new Error('Éditeur de brouillon incompatible.');
    this.db = db; this.key = `draft.editor.v1:${namespace}:${scope}`; this.kinds = kinds; this.uuid = uuid;
  }
  private field(value: string): F {
    if (!Object.hasOwn(this.kinds, value)) throw new Error('Champ de brouillon incompatible.');
    return value as F;
  }
  private serial<T>(action: () => Promise<T>): Promise<T> { const task = this.tail.then(action, action); this.tail = task; return task; }
  records(): BufferRecords<F> { return structuredCopy(this.fields); }
  prepare(inputs: BufferInputs<F>): BufferRecords<F> {
    const records: BufferRecords<F> = {};
    for (const [key, input] of Object.entries(inputs) as [string, { raw: RawFieldBuffer; clear?: boolean }][]) {
      const field = this.field(key);
      records[field] = validateFieldBuffer(this.kinds[field], { version: 1, token: this.uuid(), raw: { ...input.raw }, clear: input.clear ?? false });
    }
    return records;
  }
  read(): Promise<BufferRecords<F>> { return this.serial(async () => {
    const row = await this.db.getFirstAsync<{ value: string | null }>('SELECT value FROM settings WHERE key = ?', this.key);
    const fields: BufferRecords<F> = {};
    if (row) {
      if (typeof row.value !== 'string' || row.value.length > 256000) throw new Error('Brouillon incompatible.');
      const value = JSON.parse(row.value);
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'fields,version' || value.version !== 1 ||
          !value.fields || typeof value.fields !== 'object' || Array.isArray(value.fields)) throw new Error('Brouillon incompatible.');
      for (const [name, record] of Object.entries(value.fields)) { const field = this.field(name); fields[field] = validateFieldBuffer(this.kinds[field], record); }
    }
    this.fields = fields; this.encoded = row?.value ?? null; this.loaded = true; return this.records();
  }); }
  private async replace(fields: BufferRecords<F>) {
    if (!this.loaded) throw new Error('Brouillons non chargés.');
    const encoded = Object.keys(fields).length ? JSON.stringify({ version: 1, fields }) : null;
    if (encoded !== null && encoded.length > 256000) throw new Error('Brouillon trop volumineux.');
    const result = encoded === null
      ? this.encoded === null ? { changes: 1 } : await this.db.runAsync('DELETE FROM settings WHERE key = ? AND value = ?', this.key, this.encoded)
      : await this.db.runAsync('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at WHERE settings.value = ?',
        this.key, encoded, new Date().toISOString(), this.encoded);
    if (result.changes !== 1) throw new Error('Brouillon modifié ailleurs. Aucun écrasement forcé.');
    this.fields = fields; this.encoded = encoded;
  }
  stage(prepared: BufferRecords<F>): Promise<void> {
    const records = structuredCopy(prepared);
    for (const [key, record] of Object.entries(records)) { const field = this.field(key); validateFieldBuffer(this.kinds[field], record); }
    return this.serial(() => this.replace({ ...this.fields, ...records }));
  }
  confirm(tokens: Partial<Record<F, string>>): Promise<void> { return this.serial(async () => {
    const next = { ...this.fields }; let changed = false;
    for (const [name, token] of Object.entries(tokens)) {
      const field = this.field(name);
      if (next[field]?.token === token) { delete next[field]; changed = true; }
    }
    if (changed) await this.replace(next);
  }); }
}
function structuredCopy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
