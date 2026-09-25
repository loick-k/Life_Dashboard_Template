import { validatePatch, type DailyEntry, type DailyPatch } from './dailyEntries.ts';

interface Writer {
  patch(id: string, revision: number, patch: DailyPatch): Promise<DailyEntry>;
}
type Waiter = { resolve(): void; reject(error: unknown): void };

/** One instance per date. Navigation must await flush() before replacing it.
 * Failed edits remain in memory; never silently rebase a revision conflict.
 */
export class DailyDraft {
  private writer: Writer;
  private current: DailyEntry;
  private pending: DailyPatch[] = [];
  private running = false;
  private failure: unknown;
  private waiters: Waiter[] = [];

  constructor(writer: Writer, initial: DailyEntry) {
    this.writer = writer;
    this.current = { ...initial };
  }

  get snapshot(): DailyEntry {
    return Object.assign({}, this.current, ...this.pending);
  }
  get status(): 'saved' | 'saving' | 'failed' {
    return this.failure ? 'failed' : this.running || this.pending.length ? 'saving' : 'saved';
  }

  edit(patch: DailyPatch): void {
    const values = Object.fromEntries(validatePatch(patch));
    if (!Object.keys(values).length) return;
    this.pending.push(values);
    this.start();
  }

  flush(): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    if (!this.running && !this.pending.length) return Promise.resolve();
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  /** Explicit retry keeps the expected revision. A conflict still fails safely. */
  retry(): Promise<void> {
    this.failure = undefined;
    this.start();
    return this.flush();
  }

  private start(): void {
    if (this.running || this.failure || !this.pending.length) return;
    this.running = true;
    void this.drain();
  }

  private async drain(): Promise<void> {
    try {
      while (this.pending.length) {
        const patch = this.pending[0]!;
        this.current = await this.writer.patch(this.current.entry_id, this.current.revision, patch);
        this.pending.shift();
      }
      for (const waiter of this.waiters.splice(0)) waiter.resolve();
    } catch (error) {
      this.failure = error || new Error('Échec de sauvegarde');
      for (const waiter of this.waiters.splice(0)) waiter.reject(this.failure);
    } finally {
      this.running = false;
    }
  }
}
