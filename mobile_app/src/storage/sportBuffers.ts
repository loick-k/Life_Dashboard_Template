import { FieldBuffers, validateFieldBuffer, type BufferKind, type FieldBuffer } from './fieldBuffers.ts';
import { BufferedEditor } from './bufferedEditor.ts';
import { validateSportPatch, type SportPatch } from './sportSessions.ts';
import { parseInput } from '../domain/input.ts';
import { parseSportDuration } from '../domain/sportInput.ts';
import type { BindValue, SqlConnection } from './migrations';

export type SportField = keyof SportPatch;
const kinds: Record<SportField, BufferKind> = { sport_type: 'scalar', duration_minutes: 'duration', distance_km: 'scalar' };
export function sportBufferValue(field: SportField, record: FieldBuffer): BindValue | undefined {
  if (!Object.hasOwn(kinds, field)) throw new Error('Champ sportif incompatible.');
  validateFieldBuffer(kinds[field], record);
  if (record.clear) return null;
  let value: BindValue | undefined;
  if ('hours' in record.raw) { const parsed = parseSportDuration(record.raw.hours, record.raw.minutes); value = parsed.valid ? parsed.minutes : undefined; }
  else value = field === 'sport_type' ? record.raw.value : parseInput(record.raw.value, 'number');
  if (value === undefined) return undefined;
  try { validateSportPatch({ [field]: value }); return value; } catch { return undefined; }
}
export function sportBuffers(db: SqlConnection, id: string, uuid: () => string, notify: (kind?: 'storage' | 'business') => void) {
  return new BufferedEditor(new FieldBuffers(db, 'sport', id, kinds, uuid), sportBufferValue, notify);
}
