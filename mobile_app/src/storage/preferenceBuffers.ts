import { FieldBuffers, validateFieldBuffer, type FieldBuffer } from './fieldBuffers.ts';
import { BufferedEditor } from './bufferedEditor.ts';
import { parsePreference, preferenceDefinition, validatePreference, type PreferenceKey, type PreferenceValue } from '../domain/preferences.ts';
import type { SqlConnection } from './migrations';

export function preferenceBufferValue(key: PreferenceKey, record: FieldBuffer): PreferenceValue | undefined {
  preferenceDefinition(key); validateFieldBuffer('scalar', record);
  if (!('value' in record.raw)) throw new Error('Unité de réglage incompatible.');
  try { return record.clear ? validatePreference(key, null) : parsePreference(key, record.raw.value); } catch { return undefined; }
}
export function preferenceBuffers(db: SqlConnection, key: PreferenceKey, uuid: () => string, notify: (kind?: 'storage' | 'business') => void) {
  preferenceDefinition(key); // Never accept a secret or an unknown setting as a draft.
  return new BufferedEditor(new FieldBuffers(db, 'preference', key.replaceAll('_', '-'), { value: 'scalar' }, uuid),
    (_field, record) => preferenceBufferValue(key, record), notify);
}
