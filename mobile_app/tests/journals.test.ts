import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { migrate, type BindValue } from '../src/storage/migrations.ts';
import { DailyEntries } from '../src/storage/dailyEntries.ts';
import { Catalogs, type QueryConnection } from '../src/storage/catalogs.ts';
import { Journals, validateJournalPatch, resolveJournalDraft } from '../src/storage/journals.ts';
import { captureSnapshot, restoreSnapshot } from '../src/storage/backupSnapshot.ts';
import { readRelatedSummary } from '../src/storage/dailySummary.ts';

const { harness, press, input, label } = createRequire(import.meta.url)('./helpers/reactHarness.cjs');
const migrations = JSON.parse(readFileSync('src/storage/generated/migrations.json', 'utf8'));
async function fixture() {
  const native = new DatabaseSync(':memory:');
  const sql: QueryConnection = {
    execAsync: async statement => { native.exec(statement); },
    getFirstAsync: async <T>(statement: string, ...params: BindValue[]) => native.prepare(statement).get(...params) as T ?? null,
    getAllAsync: async <T>(statement: string, ...params: BindValue[]) => native.prepare(statement).all(...params) as T[],
    runAsync: async (statement, ...params) => ({ changes: Number(native.prepare(statement).run(...params).changes) }),
  };
  await migrate(sql, migrations); const daily = new DailyEntries(sql, randomUUID); const day = await daily.getOrCreate('2026-10-26');
  const people = new Catalogs(sql, randomUUID, 'friends'), goals = new Catalogs(sql, randomUUID, 'goals');
  const person = await people.create('Personne fictive'), goal = await goals.create('Objectif fictif');
  const social = await people.select(day.entry_id, person), contribution = await goals.select(day.entry_id, goal);
  return { native, sql, day, people, goals, person, goal, social, contribution };
}
async function choose(h: any, tree: any, name: string) {
  const node = tree.root.findAllByType('Pressable').find((item: any) => item.props.accessibilityLabel === name);
  assert.ok(node, name); await h.act(async () => node.props.onPress());
}

test('journal patches preserve identity, selection, other subjects, zero/null and round-trip through backup', async () => {
  const a = await fixture(), b = await fixture();
  try {
    const social = new Journals(a.sql, 'friends'), goals = new Journals(a.sql, 'goals');
    const created = a.native.prepare('SELECT created_at FROM social_logs WHERE social_log_id=?').get(a.social.id)!.created_at;
    let row = await social.patch(a.social.id, a.social.revision, { note: 'Échanges fictifs, été ☀', context: 'Appel téléphonique', duration_minutes: 90 });
    assert.equal(row.included, 1); assert.equal(row.subject_id, a.person);
    row = await social.patch(row.id, row.revision, { duration_minutes: 0, note: undefined }); assert.equal(row.duration_minutes, 0); assert.equal(row.note, 'Échanges fictifs, été ☀');
    await a.people.deselect(row); row = await social.read(row.id);
    row = await social.patch(row.id, row.revision, { duration_minutes: null }); assert.equal(row.included, 0);
    assert.equal(a.native.prepare('SELECT created_at FROM social_logs WHERE social_log_id=?').get(row.id)!.created_at, created);
    await a.goals.deselect(a.contribution); let goal = await goals.read(a.contribution.id);
    goal = await goals.patch(goal.id, goal.revision, { note: 'Contribution historique fictive' }); assert.equal(goal.worked, 0);
    const snapshot = await captureSnapshot(a.sql, migrations);
    await restoreSnapshot(b.sql, JSON.stringify(snapshot), migrations);
    assert.deepEqual(await new Journals(b.sql, 'friends').read(row.id), row);
    assert.deepEqual(await new Journals(b.sql, 'goals').read(goal.id), goal);
  } finally { a.native.close(); b.native.close(); }
});

test('journal validation and CAS reject unrelated fields, invalid data and second conflicts without selecting anything', async () => {
  const { native, sql, social } = await fixture();
  try {
    for (const patch of [{ duration_minutes: -1 }, { duration_minutes: 1.5 }, { duration_minutes: 1441 }, { context: '' }, { context: null }, { note: 1 }, { included: 0 }, { entry_id: 'other' }, { note: 'a'.repeat(10001) }]) assert.throws(() => validateJournalPatch('friends', patch as any));
    assert.throws(() => validateJournalPatch('goals', { duration_minutes: 0 }));
    const repo = new Journals(sql, 'friends'), original = await repo.read(social.id);
    const changed = await repo.patch(original.id, original.revision, { note: 'Note récente' });
    await assert.rejects(repo.patch(original.id, original.revision, { note: 'Ancienne note' }));
    await assert.rejects(resolveJournalDraft(repo, original, { note: 'Brouillon' }, []));
    await assert.rejects(resolveJournalDraft(repo, changed, { note: 'Brouillon' }, ['context']));
    assert.equal((await repo.read(social.id)).note, 'Note récente'); assert.equal((await repo.read(social.id)).included, 1);
  } finally { native.close(); }
});

test('real social editor autosaves precise details and keeps them through uncheck/recheck and explicit duration clear', async () => {
  const { native, sql, day, social } = await fixture(); const h = harness(sql); let tree: any;
  try {
    const { CatalogForm } = h.load('ui/CatalogForm.tsx'); const ref = h.React.createRef();
    await h.act(async () => { tree = h.create(h.React.createElement(CatalogForm, { database: sql, entryId: day.entry_id, kind: 'friends', ref })); });
    await press(h, tree, 'Afficher les détails de Personne fictive');
    await h.act(async () => input(tree, 'Personne fictive · Note').props.onChangeText('Note fictive conservée'));
    await h.act(async () => input(tree, 'Personne fictive · Contexte').props.onChangeText('Appel téléphonique'));
    await h.act(async () => input(tree, 'Personne fictive · Heures').props.onChangeText('1'));
    await h.act(async () => input(tree, 'Personne fictive · Minutes').props.onChangeText('30'));
    await press(h, tree, '☑ Personne fictive'); await press(h, tree, '☐ Personne fictive');
    assert.equal(input(tree, 'Personne fictive · Note').props.value, 'Note fictive conservée');
    assert.equal(input(tree, 'Personne fictive · Contexte').props.value, 'Appel téléphonique');
    assert.equal(input(tree, 'Personne fictive · Minutes').props.value, '30');
    const row = await new Journals(sql, 'friends').read(social.id); assert.equal(row.duration_minutes, 90); assert.equal(row.included, 1);
    await press(h, tree, 'Effacer la durée de Personne fictive');
    await h.act(async () => h.alerts.at(-1).buttons.find((item: any) => item.text === 'Effacer').onPress());
    await ref.current.flush(); const summary = await readRelatedSummary(sql, day.entry_id);
    assert.equal(summary.social[0]!.duration_minutes, null); assert.equal(summary.social[0]!.note, row.note); assert.equal(summary.social[0]!.context, row.context);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('invalid social duration prevents deselection/archive and hidden detail drafts survive collapsing and reopening', async () => {
  const { native, sql, day, social } = await fixture(); const h = harness(sql); let tree: any;
  try {
    const { CatalogForm } = h.load('ui/CatalogForm.tsx'); const ref = h.React.createRef();
    await h.act(async () => { tree = h.create(h.React.createElement(CatalogForm, { database: sql, entryId: day.entry_id, kind: 'friends', ref })); });
    await press(h, tree, 'Afficher les détails de Personne fictive');
    await h.act(async () => input(tree, 'Personne fictive · Minutes').props.onChangeText('60'));
    await press(h, tree, 'Masquer les détails de Personne fictive');
    await press(h, tree, '☑ Personne fictive');
    assert.equal((await new Journals(sql, 'friends').read(social.id)).included, 1);
    assert.equal(input(tree, 'Personne fictive · Minutes').props.value, '60');
    await press(h, tree, 'Archiver');
    await h.act(async () => h.alerts.at(-1).buttons.find((item: any) => item.text === 'Confirmer').onPress());
    assert.equal(native.prepare('SELECT active FROM friends').get()!.active, 1);
    await h.act(async () => input(tree, 'Personne fictive · Minutes').props.onChangeText('0'));
    await press(h, tree, '☑ Personne fictive'); await ref.current.flush();
    assert.equal((await new Journals(sql, 'friends').read(social.id)).duration_minutes, 0);
    assert.equal((await new Journals(sql, 'friends').read(social.id)).included, 0);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('goal note persists while unworked and a social conflict uses explicit resolution without erasing another field', async () => {
  const { native, sql, day, contribution, social } = await fixture(); const h = harness(sql); let tree: any;
  try {
    const { CatalogForm } = h.load('ui/CatalogForm.tsx');
    await h.act(async () => { tree = h.create(h.React.createElement(CatalogForm, { database: sql, entryId: day.entry_id, kind: 'goals' })); });
    await press(h, tree, 'Afficher les détails de Objectif fictif');
    await h.act(async () => input(tree, 'Objectif fictif · Note').props.onChangeText('Objectif : note fictive'));
    await press(h, tree, '☑ Objectif fictif'); await press(h, tree, '☐ Objectif fictif');
    assert.equal((await new Journals(sql, 'goals').read(contribution.id)).note, 'Objectif : note fictive');
    await h.act(async () => tree.update(h.React.createElement(CatalogForm, { key: 'social', database: sql, entryId: day.entry_id, kind: 'friends' })));
    await press(h, tree, 'Afficher les détails de Personne fictive');
    const repo = new Journals(sql, 'friends'); const original = await repo.read(social.id);
    await repo.patch(original.id, original.revision, { note: 'Note externe fictive', context: 'Contexte récent' });
    await h.act(async () => input(tree, 'Personne fictive · Note').props.onChangeText('Mon brouillon fictif'));
    await press(h, tree, 'Comparer les détails de Personne fictive');
    await choose(h, tree, 'Personne fictive · Note · Garder mon brouillon');
    await press(h, tree, 'Appliquer les choix pour Personne fictive');
    const resolved = await repo.read(social.id); assert.equal(resolved.note, 'Mon brouillon fictif'); assert.equal(resolved.context, 'Contexte récent');
    assert.equal((await new Journals(sql, 'goals').read(contribution.id)).note, 'Objectif : note fictive');
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('catalog barrier waits for every journal write even when another journal write has failed', async () => {
  const { native, sql, day, people, social } = await fixture();
  const second = await people.select(day.entry_id, await people.create('Personne B fictive'));
  let release!: () => void, delayedDone = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const delayed = { ...sql, getFirstAsync: async <T>(statement: string, ...params: BindValue[]) => {
    if (statement.startsWith('UPDATE social_logs SET note')) {
      if (params.at(-2) === social.id) throw new Error('Synthetic failure');
      if (params.at(-2) === second.id) { await gate; delayedDone = true; }
    }
    return sql.getFirstAsync<T>(statement, ...params);
  } };
  const h = harness(delayed); let tree: any;
  try {
    const { CatalogForm } = h.load('ui/CatalogForm.tsx'); const ref = h.React.createRef();
    await h.act(async () => { tree = h.create(h.React.createElement(CatalogForm, { database: delayed, entryId: day.entry_id, kind: 'friends', ref })); });
    await press(h, tree, 'Afficher les détails de Personne fictive'); await press(h, tree, 'Afficher les détails de Personne B fictive');
    await h.act(async () => input(tree, 'Personne fictive · Note').props.onChangeText('Note A fictive'));
    await h.act(async () => input(tree, 'Personne B fictive · Note').props.onChangeText('Note B fictive'));
    let ended = false; const settling = ref.current.settle().catch(() => { ended = true; });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(ended, false);
    await h.act(async () => { release(); await settling; }); assert.equal(delayedDone, true); assert.equal(ended, true);
    assert.equal(input(tree, 'Personne fictive · Note').props.value, 'Note A fictive');
    assert.equal((await new Journals(sql, 'friends').read(second.id)).note, 'Note B fictive');
    assert.equal(ref.current.hasUnconfirmed(), true);
  } finally { release(); if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('journal loading failure is retryable and never replaces imported details with defaults', async () => {
  const { native, sql, day, social } = await fixture(); let fail = true; let tree: any;
  await new Journals(sql, 'friends').patch(social.id, social.revision, { note: 'Note source fictive', context: 'Contexte source', duration_minutes: 75 });
  const failing = { ...sql, getFirstAsync: async <T>(statement: string, ...params: BindValue[]) => {
    if (fail && statement.includes('note, context, duration_minutes, included') && statement.startsWith('SELECT')) throw new Error('Synthetic read failure');
    return sql.getFirstAsync<T>(statement, ...params);
  } };
  const h = harness(failing);
  try {
    const { CatalogForm } = h.load('ui/CatalogForm.tsx'); const ref = h.React.createRef();
    await h.act(async () => { tree = h.create(h.React.createElement(CatalogForm, { database: failing, entryId: day.entry_id, kind: 'friends', ref })); });
    assert.equal(ref.current.hasUnconfirmed(), true); await h.act(async () => { await assert.rejects(ref.current.flush()); });
    assert.match(label(tree.root), /Journal indisponible/);
    fail = false; await press(h, tree, 'Relire les détails de Personne fictive');
    assert.equal(input(tree, 'Personne fictive · Note').props.value, 'Note source fictive');
    assert.equal(input(tree, 'Personne fictive · Contexte').props.value, 'Contexte source');
    assert.equal(input(tree, 'Personne fictive · Minutes').props.value, '15');
    await ref.current.flush(); assert.equal((await new Journals(sql, 'friends').read(social.id)).duration_minutes, 75);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('main navigation preserves unfinished social detail and historical date, then Continue/Back reloads the saved note', async () => {
  const { native, sql, social } = await fixture();
  native.prepare('INSERT INTO settings (key,value,updated_at) VALUES (?,?,?)').run('onboarding.v1', JSON.stringify({ version: 1, revision: 1, step: 'review', completed: true, dataChoice: 'existing' }), new Date().toISOString());
  const h = harness(sql); let tree: any;
  try {
    const App = h.load('App.tsx').default;
    await h.act(async () => { tree = h.create(h.React.createElement(App)); });
    await h.act(async () => input(tree, 'Date de l’historique').props.onChangeText('2026-10-26'));
    await press(h, tree, 'Ouvrir cette journée'); await press(h, tree, 'Suivi social');
    await press(h, tree, 'Afficher les détails de Personne fictive');
    await h.act(async () => input(tree, 'Personne fictive · Note').props.onChangeText('Note du 26 fictive'));
    await h.act(async () => input(tree, 'Personne fictive · Minutes').props.onChangeText('60'));
    await press(h, tree, 'Continuer →'); assert.equal(input(tree, 'Personne fictive · Minutes').props.value, '60');
    await press(h, tree, 'Réglages', 'tab'); await press(h, tree, 'Saisie', 'tab');
    assert.equal(input(tree, 'Personne fictive · Minutes').props.value, '60');
    await h.act(async () => input(tree, 'Personne fictive · Minutes').props.onChangeText('30'));
    await press(h, tree, 'Continuer →'); await h.back();
    await press(h, tree, 'Afficher les détails de Personne fictive');
    assert.equal(input(tree, 'Personne fictive · Note').props.value, 'Note du 26 fictive');
    assert.equal(input(tree, 'Personne fictive · Minutes').props.value, '30');
    assert.equal((await new Journals(sql, 'friends').read(social.id)).included, 1);
    assert.equal(native.prepare('SELECT entry_date FROM daily_entries WHERE entry_id=?').get((await new Journals(sql, 'friends').read(social.id)).entry_id)!.entry_date, '2026-10-26');
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});
