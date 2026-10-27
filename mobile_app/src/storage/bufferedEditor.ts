import { FieldBuffers, type BufferInputs, type BufferRecords, type FieldBuffer } from './fieldBuffers.ts';
import type { BindValue } from './migrations';
import { settleWrites } from './settleWrites.ts';

export type BufferedPatch<F extends string> = Partial<Record<F, BindValue>>;
type Writer<F extends string> = (patch: BufferedPatch<F>) => Promise<Partial<Record<F, unknown>>>;
type Retry<F extends string> = { kind: 'stage'; records: BufferRecords<F>; write: Writer<F> } | { kind: 'confirm'; tokens: Partial<Record<F, string>> };

/** Shared write-ahead/recovery coordinator; no React or native dependency.
 * Invalid raw text is durable but never converted to a business value.
 * A recovered valid intent requires comparison, never automatic replay.
 */
export class BufferedEditor<F extends string> {
  readonly invalid = new Set<F>();
  recovered: BufferedPatch<F> = {};
  restored = false;
  private readonly store: FieldBuffers<F>;
  private readonly decode: (field: F, record: FieldBuffer) => BindValue | undefined;
  private readonly notify: (kind?: 'storage' | 'business') => void;
  private readonly jobs = new Set<Promise<void>>();
  private readonly retries = new Set<Retry<F>>();
  private readonly latest = new Map<F, string>();
  constructor(store: FieldBuffers<F>, decode: (field: F, record: FieldBuffer) => BindValue | undefined, notify: (kind?: 'storage' | 'business') => void) {
    this.store = store; this.decode = decode; this.notify = notify;
  }
  async read(row: Partial<Record<F, unknown>>): Promise<BufferRecords<F>> {
    if (this.jobs.size || this.storageFailed()) throw new Error('Conservation du brouillon en cours');
    const records = await this.store.read(); this.invalid.clear(); this.recovered = {}; this.restored = false;
    this.latest.clear();
    for (const [key, record] of Object.entries(records) as [F, FieldBuffer][]) {
      this.latest.set(key, record.token); const value = this.decode(key, record);
      if (value === undefined) this.invalid.add(key);
      else if (value !== row[key]) this.recovered[key] = value;
    }
    this.restored = this.invalid.size > 0 || this.needsComparison(); return records;
  }
  needsComparison() { return Object.keys(this.recovered).length > 0; }
  isWorking() { return this.jobs.size > 0; }
  private current(operation: Retry<F>): Retry<F> {
    if (operation.kind === 'confirm') return { ...operation, tokens: Object.fromEntries(Object.entries(operation.tokens).filter(([key, token]) => this.latest.get(key as F) === token)) as Partial<Record<F, string>> };
    return { ...operation, records: Object.fromEntries(Object.entries(operation.records).filter(([key, record]) => this.latest.get(key as F) === (record as FieldBuffer).token)) as BufferRecords<F> };
  }
  storageFailed() {
    let failed = false;
    for (const operation of this.retries) {
      const current = this.current(operation);
      if (Object.keys(current.kind === 'stage' ? current.records : current.tokens).length) failed = true; else this.retries.delete(operation);
    }
    return failed;
  }
  hasUnconfirmed() { return this.jobs.size > 0 || this.storageFailed() || this.invalid.size > 0 || this.needsComparison(); }
  async settle() { await settleWrites([...this.jobs]); if (this.storageFailed()) throw new Error('Conservation du brouillon non confirmée'); }
  private forget(tokens: Partial<Record<F, string>>) {
    for (const [key, token] of Object.entries(tokens)) if (this.latest.get(key as F) === token) this.latest.delete(key as F);
  }
  private schedule(operation: Retry<F>) {
    const task = Promise.resolve().then(async () => {
      const current = this.current(operation); let retry: Retry<F> = current;
      try {
        if (current.kind === 'stage') {
          if (!Object.keys(current.records).length) return;
          await this.store.stage(current.records);
          const patch: BufferedPatch<F> = {}; let incomplete = false;
          for (const [field, record] of Object.entries(current.records) as [F, FieldBuffer][]) {
            const value = this.decode(field, record); if (value === undefined) incomplete = true; else patch[field] = value;
          }
          if (incomplete) return;
          try { await current.write(patch); } catch { this.notify('business'); return; }
          const tokens = Object.fromEntries(Object.entries(current.records).map(([key, record]) => [key, (record as FieldBuffer).token])) as Partial<Record<F, string>>;
          retry = { kind: 'confirm', tokens }; await this.store.confirm(tokens); this.forget(tokens);
        } else { await this.store.confirm(current.tokens); this.forget(current.tokens); }
      } catch { this.retries.add(retry); this.notify('storage'); }
    }).finally(() => { this.jobs.delete(task); this.notify(); });
    this.jobs.add(task); this.notify(); return task;
  }
  submit(inputs: BufferInputs<F>, write: Writer<F>) {
    if (this.needsComparison()) throw new Error('Brouillon retrouvé à comparer');
    const records = this.store.prepare(inputs);
    for (const [field, record] of Object.entries(records) as [F, FieldBuffer][]) {
      this.latest.set(field, record.token);
      if (this.decode(field, record) === undefined) this.invalid.add(field); else this.invalid.delete(field);
    }
    return this.schedule({ kind: 'stage', records, write });
  }
  retry() { const operations = [...this.retries]; this.retries.clear(); return settleWrites(operations.map(operation => this.schedule(operation))); }
  async resolved(row: Partial<Record<F, unknown>>, discarded: readonly string[]) {
    this.recovered = {}; discarded.forEach(field => this.invalid.delete(field as F));
    const tokens: Partial<Record<F, string>> = {};
    for (const [field, record] of Object.entries(this.store.records()) as [F, FieldBuffer][]) {
      const value = this.decode(field, record);
      if (discarded.includes(field) || value !== undefined && value === row[field]) tokens[field] = record.token;
    }
    await this.schedule({ kind: 'confirm', tokens });
  }
}
