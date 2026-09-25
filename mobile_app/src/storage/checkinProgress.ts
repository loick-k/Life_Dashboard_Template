import type { SqlConnection } from './migrations';
import { RevisionConflict, type DailyEntry } from './dailyEntries.ts';
import { CHECKIN_SECTIONS } from '../domain/checkinConfig.ts';

export const indicatorIds = CHECKIN_SECTIONS.filter(item => item.id !== 'summary').map(item => item.id);
export function readProgress(row: DailyEntry) {
  const read = (value: unknown): string[] => {
    const list: unknown = typeof value === 'string' ? JSON.parse(value) : null;
    if (!Array.isArray(list) || list.some(id => typeof id !== 'string' || !indicatorIds.includes(id)) || new Set(list).size !== list.length) {
      throw new Error('Progression incompatible. Aucune réinitialisation effectuée.');
    }
    return list as string[];
  };
  const completed = read(row.completed_steps);
  const skipped = read(row.skipped_steps);
  if (completed.some(id => skipped.includes(id))) throw new Error('Progression incohérente.');
  return { completed, skipped, count: completed.length + skipped.length, finished: row.checkin_finished === 1 };
}

/** Only progression columns change. Caller flushes its draft then adopts returned revision. */
export async function setCheckinProgress(database: SqlConnection, row: DailyEntry, action: { step: string; status: 'completed' | 'skipped' } | { finish: true }): Promise<DailyEntry> {
  const progress = readProgress(row);
  let completed = progress.completed;
  let skipped = progress.skipped;
  let finished = progress.finished;
  if ('finish' in action) {
    if (progress.count !== indicatorIds.length) throw new Error('Traite ou passe chaque indicateur avant de terminer.');
    finished = true;
  } else {
    if (!indicatorIds.includes(action.step) || !['completed', 'skipped'].includes(action.status)) throw new Error('Étape invalide.');
    completed = completed.filter(id => id !== action.step);
    skipped = skipped.filter(id => id !== action.step);
    (action.status === 'completed' ? completed : skipped).push(action.step);
  }
  const updated = await database.getFirstAsync<DailyEntry>(
    'UPDATE daily_entries SET completed_steps = ?, skipped_steps = ?, checkin_finished = ?, revision = revision + 1, updated_at = ? WHERE entry_id = ? AND revision = ? RETURNING *',
    JSON.stringify(completed), JSON.stringify(skipped), finished ? 1 : 0, new Date().toISOString(), row.entry_id, row.revision);
  if (!updated) throw new RevisionConflict();
  return updated;
}
