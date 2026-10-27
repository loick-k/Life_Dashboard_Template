import { DailyDraft } from './dailyDraft.ts';
import type { DailyEntries, DailyEntry, DailyPatch } from './dailyEntries.ts';

/** Called only after an explicit field-by-field decision. A second conflict still fails closed. */
export async function resolveDailyDraft(repository: DailyEntries, latest: DailyEntry, pending: DailyPatch, keepDraft: readonly string[]): Promise<DailyDraft> {
  if (keepDraft.some(key => !Object.hasOwn(pending, key)) || new Set(keepDraft).size !== keepDraft.length) throw new Error('Choix de résolution invalide.');
  const patch = Object.fromEntries(keepDraft.map(key => [key, pending[key as keyof DailyPatch]]));
  return new DailyDraft(repository, await repository.patch(latest.entry_id, latest.revision, patch));
}
