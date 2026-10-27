type Waiter = { resolve(): void; reject(error: unknown): void };

/** Per-object FIFO. Failed writes retain the draft and never rebase silently. */
export class WriteQueue<Row extends object, Patch extends object> {
  private current: Row;
  private pending: Patch[] = [];
  private running = false;
  private failure: unknown;
  private waiters: Waiter[] = [];
  private validate: (patch: Patch) => Patch;
  private write: (row: Row, patch: Patch) => Promise<Row>;
  constructor(initial: Row, validate: (patch: Patch) => Patch, write: (row: Row, patch: Patch) => Promise<Row>) {
    this.current = { ...initial }; this.validate = validate; this.write = write;
  }
  get snapshot(): Row { return Object.assign({}, this.current, ...this.pending); }
  get pendingPatch(): Patch { return Object.assign({}, ...this.pending); }
  get failureCause(): unknown { return this.failure; }
  get status(): 'saved' | 'saving' | 'failed' {
    return this.failure ? 'failed' : this.running || this.pending.length ? 'saving' : 'saved';
  }
  edit(patch: Patch): void {
    const values = this.validate(patch);
    if (!Object.keys(values).length) return;
    this.pending.push(values); this.start();
  }
  flush(): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    if (!this.running && !this.pending.length) return Promise.resolve();
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }
  retry(): Promise<void> { this.failure = undefined; this.start(); return this.flush(); }
  private start(): void {
    if (this.running || this.failure || !this.pending.length) return;
    this.running = true; void this.drain();
  }
  private async drain(): Promise<void> {
    try {
      while (this.pending.length) {
        this.current = await this.write(this.current, this.pending[0]!);
        this.pending.shift();
      }
      for (const waiter of this.waiters.splice(0)) waiter.resolve();
    } catch (error) {
      this.failure = error || new Error('Échec de sauvegarde');
      for (const waiter of this.waiters.splice(0)) waiter.reject(this.failure);
    } finally { this.running = false; }
  }
}
