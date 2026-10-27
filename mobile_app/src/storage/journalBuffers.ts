import { FieldBuffers, validateFieldBuffer, type BufferKind, type FieldBuffer } from './fieldBuffers.ts';
import { BufferedEditor } from './bufferedEditor.ts';
import { validateJournalPatch, type JournalPatch } from './journals.ts';
import type { CatalogKind } from './catalogs';
import { durationFromParts } from '../domain/durationInput.ts';
import type { BindValue, SqlConnection } from './migrations';

export type JournalField = keyof JournalPatch;
function kinds(kind: CatalogKind): Record<JournalField, BufferKind> {
  if (!['friends', 'goals'].includes(kind)) throw new Error('Journal incompatible.');
  return (kind === 'friends' ? { note: 'scalar', context: 'scalar', duration_minutes: 'duration' } : { note: 'scalar' }) as Record<JournalField, BufferKind>;
}
export function journalBufferValue(kind: CatalogKind, field: JournalField, record: FieldBuffer): BindValue | undefined {
  const definitions = kinds(kind);
  if (!Object.hasOwn(definitions, field)) throw new Error('Champ de journal incompatible.');
  validateFieldBuffer(definitions[field], record);
  const value = record.clear ? null : 'hours' in record.raw ? durationFromParts(record.raw.hours, record.raw.minutes) : record.raw.value;
  if (value === undefined) return undefined;
  try { validateJournalPatch(kind, { [field]: value }); return value; } catch { return undefined; }
}
export function journalBuffers(db: SqlConnection, kind: CatalogKind, id: string, uuid: () => string, notify: (kind?: 'storage' | 'business') => void) {
  return new BufferedEditor(new FieldBuffers(db, `journal-${kind}`, id, kinds(kind), uuid), (field, record) => journalBufferValue(kind, field, record), notify);
}
