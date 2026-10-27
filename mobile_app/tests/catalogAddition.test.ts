import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { migrate, type BindValue } from '../src/storage/migrations.ts';
import { Catalogs, type QueryConnection } from '../src/storage/catalogs.ts';
import { CatalogAddition } from '../src/storage/catalogAddition.ts';
import { captureSnapshot, restoreSnapshot } from '../src/storage/backupSnapshot.ts';

const { harness, press, input, label } = createRequire(import.meta.url)('./helpers/reactHarness.cjs');
const migrations = JSON.parse(readFileSync('src/storage/generated/migrations.json', 'utf8'));
async function fixture(path = ':memory:') {
  const native = new DatabaseSync(path); const sql: QueryConnection = {
    execAsync: async s => { native.exec(s); },
    getFirstAsync: async <T>(s: string, ...p: BindValue[]) => native.prepare(s).get(...p) as T ?? null,
    getAllAsync: async <T>(s: string, ...p: BindValue[]) => native.prepare(s).all(...p) as T[],
    runAsync: async (s, ...p) => ({ changes: Number(native.prepare(s).run(...p).changes) }),
  }; await migrate(sql, migrations); return { native, sql };
}
const addition = (sql: QueryConnection, kind: 'friends' | 'goals' = 'friends', scope = 'standalone') => new CatalogAddition(sql, kind, scope, randomUUID, () => {});
const key = 'draft.editor.v1:catalog-friends:standalone';
function noActivity(native: DatabaseSync) {
  for (const table of ['daily_entries', 'social_logs', 'goal_logs']) assert.equal(native.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n, 0);
}

test('raw addition survives a SQLite file reopen with its identity/category and without creating any activity', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'life-catalog-addition-')); const path = join(dir, 'synthetic.sqlite');
  let connection = await fixture(path);
  try {
    const draft = addition(connection.sql); await draft.read();
    await draft.edit('  Personne fictive é🌿  ', 'Association'); await draft.settle(); const expected = draft.snapshot;
    assert.equal(connection.native.prepare('SELECT count(*) AS n FROM friends').get()!.n, 0); noActivity(connection.native);
    connection.native.close(); connection = await fixture(path);
    const recovered = addition(connection.sql); await recovered.read(); assert.deepEqual(recovered.snapshot, expected); assert.equal(recovered.restored, true);
    assert.equal(recovered.hasUnconfirmed(), true);
    for (const [kind, scope] of [['goals', 'standalone'], ['friends', 'day-synthetic']] as const) {
      const other = addition(connection.sql, kind, scope); await other.read(); assert.equal(other.snapshot, null);
    }
    assert.equal(connection.native.prepare('SELECT count(*) AS n FROM friends').get()!.n, 0); noActivity(connection.native);
  } finally { connection.native.close(); rmSync(dir, { recursive: true }); }
});

test('lost SQL acknowledgement resumes explicitly with the same identity after reopen and cannot duplicate a person', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'life-catalog-ack-')); const path = join(dir, 'synthetic.sqlite'); let connection = await fixture(path);
  try {
    const port = { ...connection.sql, runAsync: async (s: string, ...p: BindValue[]) => {
      const result = await connection.sql.runAsync(s, ...p); if (s.startsWith('INSERT INTO friends')) throw new Error('Synthetic lost acknowledgement'); return result;
    } };
    const draft = addition(port); await draft.read(); await draft.edit('Personne fictive', 'Famille');
    await assert.rejects(draft.create(new Catalogs(port, randomUUID, 'friends')));
    const original = connection.native.prepare('SELECT * FROM friends').get(); const id = draft.snapshot!.id;
    assert.equal(draft.snapshot!.phase, 'prepared'); connection.native.close(); connection = await fixture(path);
    const recovered = addition(connection.sql); await recovered.read(); assert.equal(recovered.snapshot!.id, id);
    assert.throws(() => recovered.edit('Autre texte', 'Ami')); // A prepared command is immutable until explicitly resolved.
    assert.deepEqual(connection.native.prepare('SELECT * FROM friends').get(), original); noActivity(connection.native);
    assert.equal(await recovered.create(new Catalogs(connection.sql, randomUUID, 'friends')), id);
    assert.deepEqual(connection.native.prepare('SELECT * FROM friends').get(), original);
    assert.equal(connection.native.prepare('SELECT count(*) AS n FROM friends').get()!.n, 1);
    assert.equal(recovered.snapshot, null); assert.equal(connection.native.prepare('SELECT value FROM settings WHERE key=?').get(key), undefined);
  } finally { connection.native.close(); rmSync(dir, { recursive: true }); }
});

test('stable creation allows homonyms, refuses mismatching identities and never reactivates archived items', async () => {
  const { native, sql } = await fixture();
  try {
    const repo = new Catalogs(sql, randomUUID, 'friends'), id = randomUUID();
    await Promise.all([repo.createOnce(id, 'Homonyme fictif', 'Autre'), repo.createOnce(id, 'Homonyme fictif', 'Autre')]);
    await repo.create('Homonyme fictif', 'Autre'); assert.equal((await repo.list()).length, 2);
    await repo.setActive((await repo.list()).find(item => item.id === id)!, false);
    const archived = native.prepare('SELECT * FROM friends WHERE friend_id=?').get(id);
    await repo.createOnce(id, 'Homonyme fictif', 'Autre'); assert.deepEqual(native.prepare('SELECT * FROM friends WHERE friend_id=?').get(id), archived);
    await assert.rejects(repo.createOnce(id, 'Remplacement refusé', 'Autre')); await assert.rejects(repo.createOnce(id, 'Homonyme fictif', 'Famille'));
    assert.deepEqual(native.prepare('SELECT * FROM friends WHERE friend_id=?').get(id), archived); noActivity(native);
  } finally { native.close(); }
});

test('goal retry at capacity is idempotent while a fourth concurrent creation is refused', async () => {
  const { native, sql } = await fixture();
  try {
    const repo = new Catalogs(sql, randomUUID, 'goals'), id = randomUUID(); await repo.createOnce(id, 'Objectif fictif');
    await repo.create('Deuxième fictif');
    const results = await Promise.allSettled([repo.create('Troisième fictif'), repo.create('Quatrième fictif')]);
    assert.equal(results.filter(value => value.status === 'fulfilled').length, 1); assert.equal((await repo.list()).length, 3);
    const original = native.prepare('SELECT * FROM goals WHERE goal_id=?').get(id);
    await repo.createOnce(id, 'Objectif fictif'); assert.deepEqual(native.prepare('SELECT * FROM goals WHERE goal_id=?').get(id), original); noActivity(native);
  } finally { native.close(); }
});

test('a failed raw journal prevents business creation and rapid edits keep the same identity and latest text', async () => {
  const { native, sql } = await fixture(); let fail = true;
  const port = { ...sql, runAsync: async (s: string, ...p: BindValue[]) => {
    if (fail && s.startsWith('INSERT INTO settings') && p[0] === key) throw new Error('Synthetic journal full'); return sql.runAsync(s, ...p);
  } };
  try {
    const draft = addition(port); await draft.read(); void draft.edit('Première saisie', 'Ami'); const id = draft.snapshot!.id;
    await draft.edit('Dernière saisie fictive', 'Famille'); await assert.rejects(draft.settle());
    assert.equal(draft.snapshot!.id, id); assert.equal(draft.snapshot!.label, 'Dernière saisie fictive'); assert.equal(draft.storageFailed(), true);
    await assert.rejects(draft.create(new Catalogs(port, randomUUID, 'friends'))); assert.equal(native.prepare('SELECT count(*) AS n FROM friends').get()!.n, 0);
    fail = false; await draft.retry(); await draft.create(new Catalogs(port, randomUUID, 'friends'));
    const row = native.prepare('SELECT friend_id,name,category FROM friends').get()!; assert.equal(row.friend_id, id); assert.equal(row.name, 'Dernière saisie fictive'); assert.equal(row.category, 'Famille'); noActivity(native);
  } finally { native.close(); }
});

test('failed cleanup is visible in the form and retry confirms the existing item without another insert', async () => {
  const { native, sql } = await fixture(); let fail = true, inserts = 0, tree: any;
  const port = { ...sql, runAsync: async (s: string, ...p: BindValue[]) => {
    if (fail && s.startsWith('DELETE FROM settings') && p[0] === key) throw new Error('Synthetic cleanup interrupted');
    if (s.startsWith('INSERT INTO friends')) inserts++; return sql.runAsync(s, ...p);
  } }; const h = harness(port);
  try {
    const { CatalogForm } = h.load('ui/CatalogForm.tsx'); const ref = h.React.createRef();
    await h.act(async () => { tree = h.create(h.React.createElement(CatalogForm, { database: port, kind: 'friends', ref })); });
    await h.act(async () => input(tree, 'Nom de la personne').props.onChangeText('Personne fictive'));
    await press(h, tree, 'Ajouter la personne'); assert.match(label(tree.root), /Opération non confirmée/);
    assert.equal(input(tree, 'Nom de la personne').props.editable, false); assert.equal(ref.current.hasUnconfirmed(), true); await assert.rejects(ref.current.beforeClose());
    const row = native.prepare('SELECT * FROM friends').get(); fail = false; await press(h, tree, 'Ajouter la personne');
    assert.equal(inserts, 1); assert.deepEqual(native.prepare('SELECT * FROM friends').get(), row); assert.equal(ref.current.hasUnconfirmed(), false); noActivity(native);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('form remount recovers the raw category/name; Back waits for explicit abandonment without deleting catalog rows', async () => {
  const { native, sql } = await fixture(); const h = harness(sql); let tree: any, closed = 0;
  try {
    await new Catalogs(sql, randomUUID, 'friends').create('Élément existant fictif'); const { CatalogScreen } = h.load('ui/CatalogScreen.tsx');
    const props = { database: sql, kind: 'friends', onDone() { closed++; } };
    await h.act(async () => { tree = h.create(h.React.createElement(CatalogScreen, props)); });
    await h.act(async () => input(tree, 'Nom de la personne').props.onChangeText('  Brouillon é🌿  ')); await press(h, tree, 'Association');
    await h.act(async () => tree.unmount()); await h.act(async () => { tree = h.create(h.React.createElement(CatalogScreen, props)); });
    assert.equal(input(tree, 'Nom de la personne').props.value, '  Brouillon é🌿  '); assert.match(label(tree.root), /Brouillon d’ajout retrouvé/);
    assert.equal(tree.root.findAllByType('Pressable').find((n: any) => label(n) === 'Association').props.accessibilityState.selected, true);
    await h.back(); assert.equal(closed, 0); await press(h, tree, 'Annuler cet ajout');
    await h.act(async () => h.alerts.at(-1).buttons.find((b: any) => b.text === 'Abandonner cet ajout').onPress());
    await h.back(); assert.equal(closed, 1); assert.equal(native.prepare('SELECT count(*) AS n FROM friends').get()!.n, 1); noActivity(native);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('concurrent raw additions refuse overwrite/discard until an explicit reread adopts the stored draft', async () => {
  const { native, sql } = await fixture();
  try {
    const a = addition(sql), b = addition(sql); await a.read(); await a.edit('Version initiale fictive', 'Ami'); await b.read();
    await a.edit('Ajout A fictif', 'Famille'); const saved = native.prepare('SELECT value FROM settings WHERE key=?').get(key)!.value;
    await b.edit('Ajout B fictif', 'Autre'); await assert.rejects(b.settle()); await assert.rejects(b.abandon());
    assert.equal(b.snapshot!.label, 'Ajout B fictif'); assert.equal(native.prepare('SELECT value FROM settings WHERE key=?').get(key)!.value, saved);
    await b.read(); assert.deepEqual(b.snapshot, a.snapshot); await b.create(new Catalogs(sql, randomUUID, 'friends'));
    assert.equal(native.prepare('SELECT name FROM friends').get()!.name, 'Ajout A fictif'); noActivity(native);
  } finally { native.close(); }
});

test('future or domain-invalid drafts remain untouched and cannot be edited or discarded after a failed reread', async () => {
  const { native, sql } = await fixture();
  try {
    native.prepare('INSERT INTO settings(key,value,updated_at) VALUES (?,?,?)').run(key, '{"version":99}', new Date().toISOString());
    const draft = addition(sql); await assert.rejects(draft.read()); assert.throws(() => draft.edit('Pas de reset', 'Ami')); await assert.rejects(draft.abandon());
    assert.equal(native.prepare('SELECT value FROM settings WHERE key=?').get(key)!.value, '{"version":99}');
    native.prepare('DELETE FROM settings WHERE key=?').run(key); await draft.read(); await draft.edit('Texte local fictif', 'Ami');
    const raw = JSON.parse(String(native.prepare('SELECT value FROM settings WHERE key=?').get(key)!.value)); raw.fields.category.raw.value = 'Catégorie future';
    const incompatible = JSON.stringify(raw); native.prepare('UPDATE settings SET value=? WHERE key=?').run(incompatible, key);
    await assert.rejects(draft.read()); assert.equal(draft.snapshot!.label, 'Texte local fictif'); assert.equal(draft.loaded, false);
    assert.throws(() => draft.edit('Pas de remplacement', 'Ami')); await assert.rejects(draft.abandon());
    assert.equal(native.prepare('SELECT value FROM settings WHERE key=?').get(key)!.value, incompatible); noActivity(native);
  } finally { native.close(); }
});

test('portable restore excludes and retains private additions; a restored identity mismatch cannot replace an item', async () => {
  const { native, sql } = await fixture();
  try {
    const draft = addition(sql); await draft.read(); await draft.edit('Brouillon privé fictif', 'Autre'); const id = draft.snapshot!.id;
    const repo = new Catalogs(sql, randomUUID, 'friends'); await repo.createOnce(id, 'Autre contenu restauré fictif');
    const snapshot = await captureSnapshot(sql, migrations); assert.equal(snapshot.tables.settings.some(row => String(row.key).startsWith('draft.')), false);
    await restoreSnapshot(sql, JSON.stringify(snapshot), migrations); const recovered = addition(sql); await recovered.read();
    await assert.rejects(recovered.create(repo)); assert.equal(recovered.snapshot!.phase, 'prepared');
    assert.equal(native.prepare('SELECT name FROM friends WHERE friend_id=?').get(id)!.name, 'Autre contenu restauré fictif');
    await recovered.abandon(); assert.equal(native.prepare('SELECT count(*) AS n FROM friends').get()!.n, 1); noActivity(native);
  } finally { native.close(); }
});

test('closing while an addition loads waits, then refuses a recovered draft rather than losing it', async () => {
  const { native, sql } = await fixture(); let release!: () => void, tree: any;
  const seed = addition(sql); await seed.read(); await seed.edit('Brouillon lent fictif', 'Autre');
  const gate = new Promise<void>(resolve => { release = resolve; });
  const port = { ...sql, getFirstAsync: async <T>(s: string, ...p: BindValue[]) => {
    if (s === 'SELECT value FROM settings WHERE key = ?' && p[0] === key) await gate; return sql.getFirstAsync<T>(s, ...p);
  } }; const h = harness(port);
  try {
    const { CatalogForm } = h.load('ui/CatalogForm.tsx'); const ref = h.React.createRef();
    await h.act(async () => { tree = h.create(h.React.createElement(CatalogForm, { database: port, kind: 'friends', ref })); });
    assert.equal(input(tree, 'Nom de la personne').props.editable, false);
    let done = false; const close = ref.current.beforeClose().then(() => { done = true; return false; }, () => { done = true; return true; });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(done, false);
    let refused = false; await h.act(async () => { release(); refused = await close; });
    assert.equal(refused, true); assert.equal(input(tree, 'Nom de la personne').props.value, 'Brouillon lent fictif'); noActivity(native);
  } finally { release(); if (tree) await h.act(async () => tree.unmount()); native.close(); }
});
