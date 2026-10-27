import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { migrate, type BindValue } from '../src/storage/migrations.ts';
import type { QueryConnection } from '../src/storage/catalogs.ts';
import { Preferences } from '../src/storage/preferences.ts';
import { preferenceBuffers, preferenceBufferValue } from '../src/storage/preferenceBuffers.ts';
import { captureSnapshot, restoreSnapshot } from '../src/storage/backupSnapshot.ts';
const { harness, press, input, label } = createRequire(import.meta.url)('./helpers/reactHarness.cjs');
const migrations = JSON.parse(readFileSync('src/storage/generated/migrations.json', 'utf8'));
async function fixture() {
  const native = new DatabaseSync(':memory:'); const sql: QueryConnection = {
    execAsync: async s => { native.exec(s); },
    getFirstAsync: async <T>(s: string, ...p: BindValue[]) => native.prepare(s).get(...p) as T ?? null,
    getAllAsync: async <T>(s: string, ...p: BindValue[]) => native.prepare(s).all(...p) as T[],
    runAsync: async (s, ...p) => ({ changes: Number(native.prepare(s).run(...p).changes) }),
  }; await migrate(sql, migrations); return { native, sql };
}
async function choose(h: any, tree: any, name: string) {
  const node = tree.root.findAllByType('Pressable').find((n: any) => n.props.accessibilityLabel === name); assert.ok(node); await h.act(async () => node.props.onPress());
}

test('unfinished numeric/date/time/text preference buffers survive remount independently and never replace saved values', async () => {
  const { native, sql } = await fixture(); const h = harness(sql); let tree: any;
  try {
    const { PreferencesForm } = h.load('ui/PreferencesForm.tsx'); const ref = h.React.createRef(); const props = { database: sql, ref, onDone() {} };
    await h.act(async () => { tree = h.create(h.React.createElement(PreferencesForm, props)); });
    const samples = [['Sommeil cible min (h)', '7,'], ['Début standard (HH:MM)', '08:'], ['Date d’arrêt du tabac (AAAA-MM-JJ) · facultative', '2026-10-'], ['Libellé de la seconde note d’écoute', ' ']];
    for (const [name, value] of samples) await h.act(async () => input(tree, name).props.onChangeText(value));
    await h.act(async () => input(tree, 'Portable max moyen (h/j)').props.onChangeText('0'));
    await h.act(async () => tree.unmount()); await h.act(async () => { tree = h.create(h.React.createElement(PreferencesForm, props)); });
    for (const [name, value] of samples) assert.equal(input(tree, name).props.value, value);
    assert.equal((await new Preferences(sql).read('phone_max_hours')).value, 0); assert.equal((await new Preferences(sql).read('sleep_min_hours')).value, 7);
    assert.equal(ref.current.hasUnconfirmed(), true); await assert.rejects(ref.current.beforeReplace());
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('valid unconfirmed preference is never replayed and explicit comparison refuses a second conflict', async () => {
  const { native, sql } = await fixture(); let fail = true, tree: any;
  const port = { ...sql, runAsync: async (s: string, ...p: BindValue[]) => {
    if (fail && s.startsWith('INSERT INTO settings') && p[0] === 'preference.v1:sleep_min_hours') throw new Error('Synthetic interrupted preference'); return sql.runAsync(s, ...p);
  } }; const h = harness(port); const repo = new Preferences(sql);
  try {
    const { PreferencesForm } = h.load('ui/PreferencesForm.tsx'); const ref = h.React.createRef(); const props = { database: port, ref, onDone() {} };
    await h.act(async () => { tree = h.create(h.React.createElement(PreferencesForm, props)); }); await h.act(async () => input(tree, 'Sommeil cible min (h)').props.onChangeText('8'));
    await h.act(async () => tree.unmount()); fail = false; await h.act(async () => { tree = h.create(h.React.createElement(PreferencesForm, props)); });
    assert.equal(input(tree, 'Sommeil cible min (h)').props.value, '8'); assert.equal(input(tree, 'Sommeil cible min (h)').props.editable, false);
    assert.equal((await repo.read('sleep_min_hours')).value, 7); await assert.rejects(ref.current.beforeReplace());
    await press(h, tree, 'Comparer Sommeil cible min (h)'); await choose(h, tree, 'Sommeil cible min (h) · Garder mon brouillon');
    await repo.set('sleep_min_hours', 0, 9); await press(h, tree, 'Appliquer le choix pour ce réglage'); assert.equal((await repo.read('sleep_min_hours')).value, 9);
    assert.match(label(tree.root), /Opération non confirmée/); assert.equal(input(tree, 'Sommeil cible min (h)').props.value, '8');
    await press(h, tree, 'Relire la comparaison du réglage'); await choose(h, tree, 'Sommeil cible min (h) · Garder mon brouillon'); await press(h, tree, 'Appliquer le choix pour ce réglage');
    assert.equal((await repo.read('sleep_min_hours')).value, 8); assert.equal(ref.current.hasUnconfirmed(), false);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('explicitly discarding one recovered setting leaves another pending setting and its stored value unchanged', async () => {
  const { native, sql } = await fixture(); const repo = new Preferences(sql); const h = harness(sql); let tree: any;
  try {
    for (const [key, text] of [['sleep_min_hours', '8'], ['phone_max_hours', '2']] as const) {
      const editor = preferenceBuffers(sql, key, randomUUID, () => {}); await editor.read(await repo.read(key)); await editor.submit({ value: { raw: { value: text } } }, async () => { throw new Error('Synthetic stopped writer'); });
    }
    const { PreferencesForm } = h.load('ui/PreferencesForm.tsx'); const ref = h.React.createRef();
    await h.act(async () => { tree = h.create(h.React.createElement(PreferencesForm, { database: sql, ref, onDone() {} })); });
    await press(h, tree, 'Comparer Sommeil cible min (h)'); await choose(h, tree, 'Sommeil cible min (h) · Garder la valeur enregistrée'); await press(h, tree, 'Appliquer le choix pour ce réglage');
    assert.equal(input(tree, 'Sommeil cible min (h)').props.value, '7'); assert.equal(input(tree, 'Portable max moyen (h/j)').props.value, '2');
    assert.equal((await repo.read('phone_max_hours')).value, 3); assert.equal(ref.current.hasUnconfirmed(), true);
    await press(h, tree, 'Comparer Portable max moyen (h/j)'); await choose(h, tree, 'Portable max moyen (h/j) · Garder la valeur enregistrée'); await press(h, tree, 'Appliquer le choix pour ce réglage');
    assert.equal(ref.current.hasUnconfirmed(), false);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('cleanup failure retries only the journal, preserves revision and never silently clears an optional date', async () => {
  const { native, sql } = await fixture(); let fail = true, tree: any;
  const port = { ...sql, runAsync: async (s: string, ...p: BindValue[]) => {
    if (fail && s.startsWith('DELETE FROM settings')) throw new Error('Synthetic cleanup unavailable'); return sql.runAsync(s, ...p);
  } }; const h = harness(port); const repo = new Preferences(sql);
  try {
    const { PreferencesForm } = h.load('ui/PreferencesForm.tsx'); const ref = h.React.createRef();
    await h.act(async () => { tree = h.create(h.React.createElement(PreferencesForm, { database: port, ref, onDone() {} })); });
    await h.act(async () => input(tree, 'Sommeil cible min (h)').props.onChangeText('8')); const state = await repo.read('sleep_min_hours');
    assert.equal(state.value, 8); assert.equal(ref.current.hasUnconfirmed(), true); await assert.rejects(ref.current.beforeReplace());
    fail = false; await press(h, tree, 'Réessayer la conservation de Sommeil cible min (h)'); await ref.current.beforeReplace(); assert.deepEqual(await repo.read('sleep_min_hours'), state);
    await h.act(async () => input(tree, 'Date d’arrêt du tabac (AAAA-MM-JJ) · facultative').props.onChangeText('2026-10-01'));
    await h.act(async () => input(tree, 'Date d’arrêt du tabac (AAAA-MM-JJ) · facultative').props.onChangeText(''));
    assert.equal((await repo.read('tobacco_stop_date')).value, '2026-10-01'); assert.equal(ref.current.hasUnconfirmed(), true);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('private preference buffers are excluded from portable backups and retained on restore; unknown secret keys are refused', async () => {
  const { native, sql } = await fixture();
  try {
    const editor = preferenceBuffers(sql, 'work_standard_start', randomUUID, () => {}); await editor.read({ value: '08:30' });
    await editor.submit({ value: { raw: { value: '08:' } } }, async () => { throw new Error('Must not write unfinished time'); });
    const snapshot = await captureSnapshot(sql, migrations); assert.equal(snapshot.tables.settings.some(row => String(row.key).startsWith('draft.')), false);
    await restoreSnapshot(sql, JSON.stringify(snapshot), migrations); const next = preferenceBuffers(sql, 'work_standard_start', randomUUID, () => {});
    const records = await next.read({ value: '08:30' }); assert.deepEqual(records.value!.raw, { value: '08:' });
    assert.throws(() => preferenceBuffers(sql, 'todoist_token' as any, randomUUID, () => {}));
    const record = { version: 1 as const, token: randomUUID(), raw: { value: '' }, clear: true };
    assert.equal(preferenceBufferValue('tobacco_stop_date', record), null); assert.equal(preferenceBufferValue('sleep_min_hours', record), undefined);
  } finally { native.close(); }
});

test('a restore barrier started during slow preference buffer loading refuses the incomplete draft afterwards', async () => {
  const { native, sql } = await fixture(); let tree: any, release!: () => void;
  const editor = preferenceBuffers(sql, 'sleep_min_hours', randomUUID, () => {}); await editor.read({ value: 7 }); await editor.submit({ value: { raw: { value: '7,' } } }, async () => { throw new Error('No invalid write'); });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const port = { ...sql, getFirstAsync: async <T>(s: string, ...p: BindValue[]) => {
    if (s === 'SELECT value FROM settings WHERE key = ?' && String(p[0]).startsWith('draft.editor.v1:preference:')) await gate; return sql.getFirstAsync<T>(s, ...p);
  } }; const h = harness(port);
  try {
    const { PreferencesForm } = h.load('ui/PreferencesForm.tsx'); const ref = h.React.createRef();
    await h.act(async () => { tree = h.create(h.React.createElement(PreferencesForm, { database: port, ref, onDone() {} })); });
    let done = false; const operation = ref.current.beforeReplace().then(() => { done = true; return false; }, () => { done = true; return true; });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(done, false);
    let refused = false; await h.act(async () => { release(); refused = await operation; }); assert.equal(refused, true); assert.equal(input(tree, 'Sommeil cible min (h)').props.value, '7,');
  } finally { release(); if (tree) await h.act(async () => tree.unmount()); native.close(); }
});
