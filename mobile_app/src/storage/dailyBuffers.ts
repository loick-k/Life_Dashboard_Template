import type { QueryConnection } from './catalogs';
import { dailyRules, validateDate, type DailyField } from './dailyEntries.ts';
import { CHECKIN_SECTIONS } from '../domain/checkinConfig.ts';
import { parseInput } from '../domain/input.ts';
import { durationFromParts } from '../domain/durationInput.ts';
import type { BindValue } from './migrations';

export type RawDailyBuffer = { value: string } | { hours: string; minutes: string };
export interface DailyBuffer { version: 1; token: string; raw: RawDailyBuffer; clear: boolean }
const prefix = 'draft.daily.v1:';
const fields = new Map(CHECKIN_SECTIONS.flatMap(section => section.fields).map(field => [field.key, field.kind]));
function fieldName(value: string): DailyField {
  if (!Object.hasOwn(dailyRules, value)) throw new Error('Champ de brouillon incompatible.');
  return value as DailyField;
}
function validate(field: DailyField, value: unknown): DailyBuffer {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Brouillon illisible.');
  const record = value as DailyBuffer;
  if (Object.keys(record).sort().join(',') !== 'clear,raw,token,version' || record.version !== 1 || typeof record.clear !== 'boolean' ||
      typeof record.token !== 'string' || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(record.token) ||
      !record.raw || typeof record.raw !== 'object' || Array.isArray(record.raw) ||
      Object.values(record.raw).some(text => typeof text !== 'string' || text.length > 10000)) throw new Error('Brouillon incompatible.');
  const keys = Object.keys(record.raw).sort().join(',');
  if (field.endsWith('_minutes') ? keys !== 'hours,minutes' : keys !== 'value') throw new Error('Unité de brouillon incompatible.');
  if (record.clear && Object.values(record.raw).some(text => text !== '')) throw new Error('Effacement de brouillon incompatible.');
  return record;
}
/** Undefined means unfinished/invalid, never deletion. Explicit clear remains null. */
export function dailyBufferValue(field: DailyField, record: DailyBuffer): BindValue | undefined {
  validate(field, record);
  if (record.clear) return null;
  const value = 'hours' in record.raw ? durationFromParts(record.raw.hours, record.raw.minutes)
    : fields.has(field) ? parseInput(record.raw.value, fields.get(field)!) : record.raw.value;
  return value !== undefined && dailyRules[field](value) ? value : undefined;
}

/** Private device drafts, in the already encrypted database, excluded from portable snapshots.
 * Per-field CAS + token cleanup: an old acknowledgement never removes a newer buffer.
 * No replay or business-field write occurs here, including after a restart/restore.
 */
export class DailyBuffers {
  private readonly db: QueryConnection;
  private readonly date: string;
  private readonly uuid: () => string;
  private readonly saved = new Map<DailyField, { text: string; record: DailyBuffer }>();
  private loaded = false;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(db: QueryConnection, date: string, uuid: () => string) { validateDate(date); this.db = db; this.date = date; this.uuid = uuid; }
  private key(field: DailyField) { return `${prefix}${this.date}:${field}`; }
  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const next = this.tail.then(action, action); this.tail = next; return next;
  }
  async read(): Promise<Map<DailyField, DailyBuffer>> {
    const base = `${prefix}${this.date}:`;
    const rows = await this.db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings WHERE key LIKE ?', base + '%');
    const records = new Map<DailyField, { text: string; record: DailyBuffer }>();
    for (const row of rows) {
      if (!row.key.startsWith(base) || typeof row.value !== 'string' || row.value.length > 22000) throw new Error('Brouillon incompatible.');
      const field = fieldName(row.key.slice(base.length)); const record = validate(field, JSON.parse(row.value));
      records.set(field, { text: row.value, record });
    }
    this.saved.clear(); for (const [field, item] of records) this.saved.set(field, item);
    this.loaded = true; return this.records();
  }
  records() { return new Map([...this.saved].map(([field, item]) => [field, item.record])); }
  stage(field: DailyField, raw: RawDailyBuffer, clear = false): Promise<DailyBuffer> {
    const record = validate(fieldName(field), { version: 1, token: this.uuid(), raw: { ...raw }, clear });
    return this.enqueue(async () => {
      if (!this.loaded) throw new Error('Brouillons non chargés.');
      const previous = this.saved.get(field), text = JSON.stringify(record);
      const result = await this.db.runAsync('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at WHERE settings.value = ?',
        this.key(field), text, new Date().toISOString(), previous?.text ?? null);
      if (result.changes !== 1) throw new Error('Brouillon modifié ailleurs. Aucune saisie écrasée.');
      this.saved.set(field, { text, record }); return record;
    });
  }
  confirm(field: DailyField, token: string): Promise<void> {
    return this.enqueue(async () => {
      const previous = this.saved.get(field);
      if (!previous || previous.record.token !== token) return;
      const result = await this.db.runAsync('DELETE FROM settings WHERE key = ? AND value = ?', this.key(field), previous.text);
      if (result.changes !== 1) throw new Error('Brouillon modifié ailleurs. Aucune saisie effacée.');
      this.saved.delete(field);
    });
  }
}
