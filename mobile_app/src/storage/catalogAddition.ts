import { FieldBuffers, type BufferRecords } from './fieldBuffers.ts';
import { FRIEND_CATEGORIES, type CatalogKind, type Catalogs } from './catalogs.ts';
import type { SqlConnection } from './migrations';

type Field = 'candidate_id' | 'label' | 'category' | 'phase';
export interface Addition { id: string; label: string; category: string; phase: 'editing' | 'prepared' }
const kinds = { candidate_id: 'scalar', label: 'scalar', category: 'scalar', phase: 'scalar' } as const;
function decode(records: BufferRecords<Field>): Addition | null {
  if (!Object.keys(records).length) return null;
  if (Object.keys(records).sort().join(',') !== 'candidate_id,category,label,phase') throw new Error('Ajout incomplet ou incompatible.');
  const value = (key: Field) => { const field = records[key]!; if (field.clear || !('value' in field.raw)) throw new Error('Ajout incompatible.'); return field.raw.value; };
  const id = value('candidate_id'), label = value('label'), category = value('category'), phase = value('phase');
  if (!/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id) || label.length > 200 || !FRIEND_CATEGORIES.includes(category) ||
      !['editing', 'prepared'].includes(phase) || phase === 'prepared' && !label.trim()) throw new Error('Ajout incompatible.');
  return { id, label, category, phase: phase as Addition['phase'] };
}

/** Raw addition + stable creation identity, private to a screen/date context.
 * Typing never creates a catalog item. Prepared commands resume explicitly only.
 * Abandoning local tracking never deletes an already-created person/goal.
 */
export class CatalogAddition {
  private readonly store: FieldBuffers<Field>;
  private readonly uuid: () => string;
  private readonly notify: (error?: boolean) => void;
  private current: Addition | null = null;
  private failure: Addition | null = null;
  private tail: Promise<void> = Promise.resolve();
  private generation = 0;
  private pending = 0;
  private working = false;
  private reading = false;
  loaded = false;
  restored = false;
  constructor(db: SqlConnection, kind: CatalogKind, scope: string, uuid: () => string, notify: (error?: boolean) => void) {
    if (!['friends', 'goals'].includes(kind)) throw new Error('Répertoire incompatible.');
    this.store = new FieldBuffers(db, `catalog-${kind}`, scope, kinds, uuid); this.uuid = uuid; this.notify = notify;
  }
  get snapshot(): Addition | null { return this.current ? { ...this.current } : null; }
  isWorking() { return this.working || this.reading || this.pending > 0; }
  isMutating() { return this.working; }
  storageFailed() { return this.failure !== null; }
  hasUnconfirmed() { return this.isWorking() || this.storageFailed() || !!this.current?.label.trim() || this.current?.phase === 'prepared'; }
  async read() {
    if (this.isWorking()) throw new Error('Ajout en cours');
    this.reading = true; this.loaded = false; this.notify();
    try {
      const next = decode(await this.store.read());
      this.current = next; this.loaded = true; this.restored = next !== null; this.failure = null;
    } finally { this.reading = false; this.notify(); }
  }
  private persist(value: Addition) {
    const revision = ++this.generation;
    const prepared = this.store.prepare({ candidate_id: { raw: { value: value.id } }, label: { raw: { value: value.label } }, category: { raw: { value: value.category } }, phase: { raw: { value: value.phase } } });
    this.pending++;
    const task = this.tail.then(async () => {
      try { await this.store.stage(prepared); if (revision === this.generation) this.failure = null; }
      catch { if (revision === this.generation) { this.failure = { ...value }; this.notify(true); } }
    }).finally(() => { this.pending--; this.notify(); });
    this.tail = task; this.notify(); return task;
  }
  edit(label: string, category: string) {
    if (!this.loaded || this.working || this.current?.phase === 'prepared') throw new Error('Ajout à confirmer avant modification');
    if (label.length > 200 || !FRIEND_CATEGORIES.includes(category)) throw new Error('Nom ou catégorie invalide');
    this.current = { id: this.current?.id ?? this.uuid(), label, category, phase: 'editing' };
    return this.persist(this.current);
  }
  async settle() { await this.tail; if (!this.loaded || this.failure) throw new Error('Conservation de l’ajout non confirmée'); }
  async retry() {
    if (this.working || !this.failure) return;
    await this.persist(this.failure); await this.settle();
  }
  async create(repository: Pick<Catalogs, 'createOnce'>) {
    if (this.working) throw new Error('Ajout en cours');
    this.working = true; this.notify();
    try {
      await this.settle(); const value = this.current;
      if (!value?.label.trim()) throw new Error('Nom requis');
      if (value.phase === 'editing') { this.current = { ...value, phase: 'prepared' }; await this.persist(this.current); await this.settle(); }
      const confirmed = await repository.createOnce(value.id, value.label, value.category);
      await this.clear(); return confirmed;
    } finally { this.working = false; this.notify(); }
  }
  private async clear() {
    const tokens = Object.fromEntries(Object.entries(this.store.records()).map(([key, record]) => [key, record.token]));
    await this.store.confirm(tokens); this.current = null; this.failure = null; this.restored = false; this.notify();
  }
  async abandon() {
    if (this.working || !this.loaded) throw new Error('Ajout en cours ou non chargé');
    this.working = true; this.notify();
    try { await this.tail; await this.clear(); } finally { this.working = false; this.notify(); }
  }
}
