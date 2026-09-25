import { validatePatch, type DailyEntry, type DailyPatch } from './dailyEntries.ts';
import { WriteQueue } from './writeQueue.ts';

interface Writer { patch(id: string, revision: number, patch: DailyPatch): Promise<DailyEntry> }

/** One per date. Navigation waits for flush; no silent rebasing of stale edits. */
export class DailyDraft extends WriteQueue<DailyEntry, DailyPatch> {
  constructor(writer: Writer, initial: DailyEntry) {
    super(initial, patch => Object.fromEntries(validatePatch(patch)),
      (row, patch) => writer.patch(row.entry_id, row.revision, patch));
  }
}
