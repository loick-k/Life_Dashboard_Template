import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { migrate, type BindValue } from '../src/storage/migrations.ts';
import { DailyEntries } from '../src/storage/dailyEntries.ts';
import { Catalogs, type QueryConnection } from '../src/storage/catalogs.ts';
import { Journals } from '../src/storage/journals.ts';
import { journalBuffers, journalBufferValue } from '../src/storage/journalBuffers.ts';
import { captureSnapshot, restoreSnapshot } from '../src/storage/backupSnapshot.ts';
const { harness, press, input, label } = createRequire(import.meta.url)('./helpers/reactHarness.cjs');
const migrations = JSON.parse(readFileSync('src/storage/generated/migrations.json', 'utf8'));
async function fixture() {
  const native = new DatabaseSync(':memory:'); const sql: QueryConnection = {
    execAsync: async s => { native.exec(s); },
    getFirstAsync: async <T>(s: string, ...p: BindValue[]) => native.prepare(s).get(...p) as T ?? null,
    getAllAsync: async <T>(s: string, ...p: BindValue[]) => native.prepare(s).all(...p) as T[],
    runAsync: async (s, ...p) => ({ changes: Number(native.prepare(s).run(...p).changes) }),
  };
  await migrate(sql, migrations); const day = await new DailyEntries(sql, randomUUID).getOrCreate('2026-10-26');
  const friends = new Catalogs(sql, randomUUID, 'friends'), goals = new Catalogs(sql, randomUUID, 'goals');
  const social = await friends.select(day.entry_id, await friends.create('Personne fictive'));
  const goal = await goals.select(day.entry_id, await goals.create('Objectif fictif'));
  return { native, sql, day, friends, goals, social, goal };
}
async function choice(h: any, tree: any, name: string) {
  const node = tree.root.findAllByType('Pressable').find((n: any) => n.props.accessibilityLabel === name); assert.ok(node); await h.act(async () => node.props.onPress());
}

test('incomplete context and precise social time survive remount without selecting the person or changing the note', async () => {
  const { native, sql, friends, social } = await fixture(); const h = harness(sql); let tree: any;
  try {
    await friends.deselect(social); const repo = new Journals(sql, 'friends'); let row = await repo.read(social.id); row = await repo.patch(row.id, row.revision, { note: 'Note fictive été 🥗', context: 'Appel', duration_minutes: 90 });
    const { JournalEditor } = h.load('ui/JournalEditor.tsx'); const ref = h.React.createRef(); const props = { database: sql, kind: 'friends', id: row.id, label: 'Personne fictive', ref };
    await h.act(async () => { tree = h.create(h.React.createElement(JournalEditor, props)); }); await press(h, tree, 'Afficher les détails de Personne fictive');
    await h.act(async () => input(tree, 'Personne fictive · Contexte').props.onChangeText(''));
    await h.act(async () => input(tree, 'Personne fictive · Minutes').props.onChangeText('2,'));
    await h.act(async () => tree.unmount()); await h.act(async () => { tree = h.create(h.React.createElement(JournalEditor, props)); });
    assert.equal(input(tree, 'Personne fictive · Contexte').props.value, ''); assert.equal(input(tree, 'Personne fictive · Minutes').props.value, '2,');
    assert.equal(input(tree, 'Personne fictive · Note').props.value, row.note); assert.equal(ref.current.hasUnconfirmed(), true);
    await h.act(async () => { await assert.rejects(ref.current.flush()); });
    assert.equal((await repo.read(row.id)).duration_minutes, 90); assert.equal((await repo.read(row.id)).included, 0);
    await h.act(async () => input(tree, 'Personne fictive · Contexte').props.onChangeText('Promenade fictive'));
    await h.act(async () => input(tree, 'Personne fictive · Minutes').props.onChangeText('23')); await ref.current.flush();
    const latest = await repo.read(row.id); assert.equal(latest.duration_minutes, 83); assert.equal(latest.note, row.note); assert.equal(latest.included, 0);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('goal note interrupted before SQL is recovered without marking worked and remains protected against a second conflict', async () => {
  const { native, sql, goals, goal } = await fixture(); await goals.deselect(goal); let fail = true, tree: any;
  const port = { ...sql, getFirstAsync: async <T>(s: string, ...p: BindValue[]) => {
    if (fail && s.startsWith('UPDATE goal_logs SET note')) throw new Error('Synthetic interrupted note'); return sql.getFirstAsync<T>(s, ...p);
  } }; const h = harness(port); const repo = new Journals(sql, 'goals');
  try {
    const { JournalEditor } = h.load('ui/JournalEditor.tsx'); const ref = h.React.createRef(); const props = { database: port, kind: 'goals', id: goal.id, label: 'Objectif fictif', ref };
    await h.act(async () => { tree = h.create(h.React.createElement(JournalEditor, props)); }); await press(h, tree, 'Afficher les détails de Objectif fictif');
    await h.act(async () => input(tree, 'Objectif fictif · Note').props.onChangeText('Brouillon fictif été ☀'));
    await h.act(async () => tree.unmount()); fail = false; await h.act(async () => { tree = h.create(h.React.createElement(JournalEditor, props)); });
    assert.equal(input(tree, 'Objectif fictif · Note').props.value, 'Brouillon fictif été ☀'); assert.equal(input(tree, 'Objectif fictif · Note').props.editable, false);
    assert.equal((await repo.read(goal.id)).note, null); assert.equal((await repo.read(goal.id)).worked, 0);
    await press(h, tree, 'Comparer les détails de Objectif fictif'); await choice(h, tree, 'Objectif fictif · Note · Garder mon brouillon');
    const current = await repo.read(goal.id); await repo.patch(current.id, current.revision, { note: 'Note externe fictive' });
    await press(h, tree, 'Appliquer les choix pour Objectif fictif'); assert.match(label(tree.root), /Résolution non confirmée/);
    assert.equal((await repo.read(goal.id)).note, 'Note externe fictive');
    await press(h, tree, 'Relire la comparaison pour Objectif fictif'); await choice(h, tree, 'Objectif fictif · Note · Garder mon brouillon');
    await press(h, tree, 'Appliquer les choix pour Objectif fictif'); await ref.current.flush();
    assert.equal((await repo.read(goal.id)).note, 'Brouillon fictif été ☀'); assert.equal((await repo.read(goal.id)).worked, 0);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('cleanup failure after a saved note stays visible and retry cleans only private state without replaying SQL', async () => {
  const { native, sql, social } = await fixture(); let fail = true, tree: any;
  const port = { ...sql, runAsync: async (s: string, ...p: BindValue[]) => {
    if (fail && s.startsWith('DELETE FROM settings')) throw new Error('Synthetic cleanup unavailable'); return sql.runAsync(s, ...p);
  } }; const h = harness(port); const repo = new Journals(sql, 'friends');
  try {
    const { JournalEditor } = h.load('ui/JournalEditor.tsx'); const ref = h.React.createRef();
    await h.act(async () => { tree = h.create(h.React.createElement(JournalEditor, { database: port, kind: 'friends', id: social.id, label: 'Personne fictive', ref })); }); await press(h, tree, 'Afficher les détails de Personne fictive');
    await h.act(async () => input(tree, 'Personne fictive · Note').props.onChangeText('Note fictive confirmée'));
    const row = await repo.read(social.id); assert.equal(row.note, 'Note fictive confirmée'); assert.equal(ref.current.hasUnconfirmed(), true);
    assert.doesNotMatch(label(tree.root), /Détails enregistrés localement/); await h.act(async () => { await assert.rejects(ref.current.flush()); });
    fail = false; await press(h, tree, 'Réessayer la conservation des détails de Personne fictive'); await ref.current.flush();
    assert.equal((await repo.read(row.id)).revision, row.revision); assert.match(label(tree.root), /Détails enregistrés localement/);
    assert.equal(ref.current.hasUnconfirmed(), false); assert.doesNotMatch(label(tree.root), /Garde cet écran ouvert/);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('restoring portable data preserves private journal buffers but never exports or applies them to selection flags', async () => {
  const { native, sql, friends, social, goal } = await fixture();
  try {
    await friends.deselect(social); const repo = new Journals(sql, 'friends'), row = await repo.read(social.id);
    const editor = journalBuffers(sql, 'friends', row.id, randomUUID, () => {}); await editor.read(row);
    await editor.submit({ note: { raw: { value: 'Note en attente fictive ☀' } } }, async () => { throw new Error('Synthetic stopped writer'); });
    const snapshot = await captureSnapshot(sql, migrations); assert.equal(snapshot.tables.settings.some(item => String(item.key).startsWith('draft.')), false);
    await restoreSnapshot(sql, JSON.stringify(snapshot), migrations); const reopened = journalBuffers(sql, 'friends', row.id, randomUUID, () => {}); await reopened.read(await repo.read(row.id));
    assert.equal(reopened.needsComparison(), true); assert.equal((await repo.read(row.id)).included, 0); assert.equal((await repo.read(row.id)).note, row.note);
    assert.equal((await new Journals(sql, 'goals').read(goal.id)).note, null);
    const raw = { version: 1 as const, token: randomUUID(), raw: { value: '' }, clear: false };
    assert.equal(journalBufferValue('friends', 'context', raw), undefined); assert.equal(journalBufferValue('friends', 'note', raw), '');
    assert.equal(journalBufferValue('friends', 'duration_minutes', { ...raw, raw: { hours: '', minutes: '0' } }), 0);
    assert.throws(() => journalBufferValue('goals', 'context', raw));
  } finally { native.close(); }
});

test('a journal barrier started during slow buffer loading refuses the recovered incomplete duration', async () => {
  const { native, sql, social } = await fixture(); let tree: any, release!: () => void;
  const editor = journalBuffers(sql, 'friends', social.id, randomUUID, () => {}); await editor.read(await new Journals(sql, 'friends').read(social.id));
  await editor.submit({ duration_minutes: { raw: { hours: '1', minutes: '2,' } } }, async () => { throw new Error('Must not write invalid input'); });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const port = { ...sql, getFirstAsync: async <T>(s: string, ...p: BindValue[]) => {
    if (s === 'SELECT value FROM settings WHERE key = ?' && String(p[0]).startsWith('draft.editor.')) await gate; return sql.getFirstAsync<T>(s, ...p);
  } }; const h = harness(port);
  try {
    const { JournalEditor } = h.load('ui/JournalEditor.tsx'); const ref = h.React.createRef();
    await h.act(async () => { tree = h.create(h.React.createElement(JournalEditor, { database: port, kind: 'friends', id: social.id, label: 'Personne fictive', ref })); });
    let completed = false; const operation = ref.current.flush().then(() => { completed = true; return false; }, () => { completed = true; return true; });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(completed, false);
    let refused = false; await h.act(async () => { release(); refused = await operation; }); assert.equal(refused, true);
    assert.equal(input(tree, 'Personne fictive · Minutes').props.value, '2,'); assert.equal(ref.current.hasUnconfirmed(), true);
  } finally { release(); if (tree) await h.act(async () => tree.unmount()); native.close(); }
});
