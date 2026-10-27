import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { migrate, type BindValue } from '../src/storage/migrations.ts';
import { DailyEntries } from '../src/storage/dailyEntries.ts';
import type { QueryConnection } from '../src/storage/catalogs.ts';

const { harness, press, input, label, visible } = createRequire(import.meta.url)('./helpers/reactHarness.cjs');
const migrations = JSON.parse(readFileSync('src/storage/generated/migrations.json', 'utf8'));
async function fixture() {
  const native = new DatabaseSync(':memory:');
  const sql: QueryConnection = {
    execAsync: async statement => { native.exec(statement); },
    getFirstAsync: async <T>(statement: string, ...params: BindValue[]) => native.prepare(statement).get(...params) as T ?? null,
    getAllAsync: async <T>(statement: string, ...params: BindValue[]) => native.prepare(statement).all(...params) as T[],
    runAsync: async (statement, ...params) => ({ changes: Number(native.prepare(statement).run(...params).changes) }),
  };
  await migrate(sql, migrations); return { native, sql };
}
function configured(native: DatabaseSync) {
  native.prepare('INSERT INTO settings (key,value,updated_at) VALUES (?,?,?)').run('onboarding.v1', JSON.stringify({ version: 1, revision: 1, step: 'review', completed: true, dataChoice: 'existing' }), new Date().toISOString());
}

test('standalone catalog adds people and goals without creating a day or any daily log', async () => {
  const { native, sql } = await fixture(); const h = harness(sql); let tree: any;
  try {
    const { CatalogScreen } = h.load('ui/CatalogScreen.tsx');
    await h.act(async () => { tree = h.create(h.React.createElement(CatalogScreen, { database: sql, kind: 'friends', onDone() {} })); });
    await h.act(async () => input(tree, 'Nom de la personne').props.onChangeText('Personne fictive'));
    await press(h, tree, 'Famille'); await press(h, tree, 'Ajouter la personne');
    assert.equal(native.prepare('SELECT category FROM friends').get()!.category, 'Famille');
    assert.equal(tree.root.findAllByType('Pressable').filter((n: any) => n.props.accessibilityRole === 'checkbox').length, 0);
    await h.act(async () => tree.update(h.React.createElement(CatalogScreen, { key: 'goals', database: sql, kind: 'goals', onDone() {} })));
    await h.act(async () => input(tree, 'Titre de l’objectif').props.onChangeText('Objectif fictif'));
    await press(h, tree, 'Ajouter l’objectif');
    for (const table of ['daily_entries', 'social_logs', 'goal_logs']) assert.equal(native.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n, 0);
    assert.equal(native.prepare('SELECT count(*) AS n FROM goals').get()!.n, 1);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('adding inside a daily social step no longer invents an interaction; selection is separate and explicit', async () => {
  const { native, sql } = await fixture(); const h = harness(sql); let tree: any;
  try {
    const day = await new DailyEntries(sql, randomUUID).getOrCreate('2026-10-26');
    const { CatalogForm } = h.load('ui/CatalogForm.tsx');
    await h.act(async () => { tree = h.create(h.React.createElement(CatalogForm, { database: sql, kind: 'friends', entryId: day.entry_id })); });
    await h.act(async () => input(tree, 'Nom de la personne').props.onChangeText('Personne fictive'));
    await press(h, tree, 'Ajouter la personne');
    assert.equal(native.prepare('SELECT count(*) AS n FROM social_logs').get()!.n, 0);
    await press(h, tree, '☐ Personne fictive');
    assert.equal(native.prepare('SELECT count(*) AS n FROM social_logs WHERE included = 1').get()!.n, 1);
    await press(h, tree, '☑ Personne fictive'); assert.equal(native.prepare('SELECT count(*) AS n FROM social_logs WHERE included = 1').get()!.n, 0);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('unfinished catalog addition survives Back until an explicit abandonment and failed creation remains retryable', async () => {
  const { native, sql } = await fixture(); let fail = true, closed = 0; let tree: any;
  const failing = { ...sql, runAsync: async (statement: string, ...params: BindValue[]) => {
    if (fail && statement.startsWith('INSERT INTO friends')) throw new Error('Synthetic failure');
    return sql.runAsync(statement, ...params);
  } };
  const h = harness(failing);
  try {
    const { CatalogScreen } = h.load('ui/CatalogScreen.tsx');
    await h.act(async () => { tree = h.create(h.React.createElement(CatalogScreen, { database: failing, kind: 'friends', onDone() { closed++; } })); });
    await h.act(async () => input(tree, 'Nom de la personne').props.onChangeText('Brouillon fictif'));
    await h.back(); assert.equal(closed, 0); assert.equal(input(tree, 'Nom de la personne').props.value, 'Brouillon fictif');
    await press(h, tree, 'Ajouter la personne'); assert.match(label(tree.root), /Opération non confirmée/);
    assert.equal(input(tree, 'Nom de la personne').props.value, 'Brouillon fictif');
    fail = false; await press(h, tree, 'Recharger les valeurs'); await press(h, tree, 'Ajouter la personne');
    assert.equal(native.prepare('SELECT count(*) AS n FROM friends').get()!.n, 1);
    await h.act(async () => input(tree, 'Nom de la personne').props.onChangeText('Autre brouillon'));
    await press(h, tree, 'Annuler cet ajout');
    await h.act(async () => h.alerts.at(-1).buttons.find((b: any) => b.text === 'Abandonner cet ajout').onPress());
    await h.back(); assert.equal(closed, 1);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('main app opens independent catalog from a historical daily step and refreshes its checklist on return', async () => {
  const { native, sql } = await fixture(); configured(native); const h = harness(sql); let tree: any;
  try {
    const App = h.load('App.tsx').default;
    await h.act(async () => { tree = h.create(h.React.createElement(App)); });
    await h.act(async () => input(tree, 'Date de l’historique').props.onChangeText('2026-10-26'));
    await press(h, tree, 'Ouvrir cette journée'); await press(h, tree, 'Suivi social');
    await press(h, tree, 'Gérer les personnes suivies');
    await h.act(async () => input(tree, 'Nom de la personne').props.onChangeText('Personne historique fictive'));
    await press(h, tree, 'Ajouter la personne'); await h.back();
    const checkbox = tree.root.findAllByType('Pressable').find((n: any) => visible(n) && label(n) === '☐ Personne historique fictive');
    assert.ok(checkbox); assert.match(label(tree.root), /2026-10-26/);
    assert.equal(native.prepare('SELECT count(*) AS n FROM social_logs').get()!.n, 0);
    await press(h, tree, '☐ Personne historique fictive');
    const saved = native.prepare('SELECT d.entry_date FROM social_logs s JOIN daily_entries d ON d.entry_id=s.entry_id').get()!;
    assert.equal(saved.entry_date, '2026-10-26');
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('settings catalog route keeps an incomplete daily time intact and does not create daily activity', async () => {
  const { native, sql } = await fixture(); configured(native); const h = harness(sql); let tree: any;
  try {
    const App = h.load('App.tsx').default;
    await h.act(async () => { tree = h.create(h.React.createElement(App)); });
    await press(h, tree, 'Temps de travail');
    await h.act(async () => input(tree, 'Fin de matinée').props.onChangeText('12:'));
    await press(h, tree, 'Réglages', 'tab'); await press(h, tree, 'Gérer mes objectifs');
    await h.act(async () => input(tree, 'Titre de l’objectif').props.onChangeText('Objectif fictif'));
    await press(h, tree, 'Ajouter l’objectif'); await h.back(); await press(h, tree, 'Saisie', 'tab');
    assert.equal(input(tree, 'Fin de matinée').props.value, '12:');
    assert.equal(native.prepare('SELECT count(*) AS n FROM goal_logs').get()!.n, 0);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});
