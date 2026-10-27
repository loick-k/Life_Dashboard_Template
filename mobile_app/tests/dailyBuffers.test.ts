import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrate, type BindValue } from '../src/storage/migrations.ts';
import type { QueryConnection } from '../src/storage/catalogs.ts';
import { DailyEntries } from '../src/storage/dailyEntries.ts';
import { DailyBuffers, dailyBufferValue } from '../src/storage/dailyBuffers.ts';
import { captureSnapshot, restoreSnapshot } from '../src/storage/backupSnapshot.ts';
const { harness, press, input, label, button } = createRequire(import.meta.url)('./helpers/reactHarness.cjs');
const migrations = JSON.parse(readFileSync('src/storage/generated/migrations.json', 'utf8'));
function adapter(native: DatabaseSync): QueryConnection {
  return { execAsync: async s => { native.exec(s); },
    getFirstAsync: async <T>(s: string, ...p: BindValue[]) => native.prepare(s).get(...p) as T ?? null,
    getAllAsync: async <T>(s: string, ...p: BindValue[]) => native.prepare(s).all(...p) as T[],
    runAsync: async (s, ...p) => ({ changes: Number(native.prepare(s).run(...p).changes) }),
  };
}
async function fixture() { const native = new DatabaseSync(':memory:'); const sql = adapter(native); await migrate(sql, migrations); return { native, sql }; }

test('daily buffers survive file SQLite reopening exactly, distinguish unfinished/zero/clear and never write business values', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'life-draft-test-')); let native = new DatabaseSync(join(folder, 'synthetic.db'));
  try {
    let sql = adapter(native); await migrate(sql, migrations); let store = new DailyBuffers(sql, '2026-10-26', randomUUID); await store.read();
    await store.stage('work_start_time', { value: '08:' });
    await store.stage('weight_kg', { value: '72,' });
    await store.stage('phone_minutes', { hours: '1', minutes: '2,' });
    await store.stage('meal_lunch', { value: 'Texte fictif 🥗 été' });
    await store.stage('alcohol_glasses', { value: '0' });
    await store.stage('body_fat_pct', { value: '' }, true);
    const before = [...store.records()]; native.close(); native = new DatabaseSync(join(folder, 'synthetic.db')); sql = adapter(native);
    store = new DailyBuffers(sql, '2026-10-26', randomUUID); const restored = await store.read(); assert.deepEqual([...restored], before);
    assert.equal(dailyBufferValue('work_start_time', restored.get('work_start_time')!), undefined);
    assert.equal(dailyBufferValue('phone_minutes', restored.get('phone_minutes')!), undefined);
    assert.equal(dailyBufferValue('meal_lunch', restored.get('meal_lunch')!), 'Texte fictif 🥗 été');
    assert.equal(dailyBufferValue('alcohol_glasses', restored.get('alcohol_glasses')!), 0);
    assert.equal(dailyBufferValue('body_fat_pct', restored.get('body_fat_pct')!), null);
    assert.equal(native.prepare('SELECT count(*) AS n FROM daily_entries').get()!.n, 0);
    const other = new DailyBuffers(sql, '2026-10-25', randomUUID); assert.equal((await other.read()).size, 0);
  } finally { native.close(); rmSync(folder, { recursive: true, force: true }); }
});

test('daily buffer CAS refuses another editor and an old acknowledgement never deletes a newer intent', async () => {
  const { native, sql } = await fixture();
  try {
    const a = new DailyBuffers(sql, '2026-10-26', randomUUID), b = new DailyBuffers(sql, '2026-10-26', randomUUID); await a.read(); await b.read();
    const first = await a.stage('weight_kg', { value: '72' });
    await assert.rejects(b.stage('weight_kg', { value: '73' }));
    const next = await a.stage('weight_kg', { value: '74' }); await a.confirm('weight_kg', first.token);
    assert.equal(a.records().get('weight_kg')!.token, next.token);
    await a.confirm('weight_kg', next.token); assert.equal((await a.read()).size, 0);
  } finally { native.close(); }
});

test('private buffers are excluded from portable backups, preserved by restore, and corrupt data is never reset', async () => {
  const { native, sql } = await fixture();
  try {
    const day = await new DailyEntries(sql, randomUUID).getOrCreate('2026-10-26');
    const store = new DailyBuffers(sql, day.entry_date, randomUUID); await store.read(); await store.stage('work_start_time', { value: '08:' });
    const snapshot = await captureSnapshot(sql, migrations);
    assert.equal(snapshot.tables.settings.some(row => String(row.key).startsWith('draft.')), false);
    await restoreSnapshot(sql, JSON.stringify(snapshot), migrations); assert.deepEqual((await store.read()).get('work_start_time')!.raw, { value: '08:' });
    const key = 'draft.daily.v1:2026-10-25:weight_kg';
    await sql.runAsync('INSERT INTO settings VALUES (?,?,?)', key, '{"version":99}', '2026-10-27');
    await assert.rejects(new DailyBuffers(sql, '2026-10-25', randomUUID).read());
    assert.equal(native.prepare('SELECT value FROM settings WHERE key=?').get(key)!.value, '{"version":99}');
  } finally { native.close(); }
});

test('incomplete daily clocks are restored after remount, accessible from home, and never become zero or erase another measure', async () => {
  const { native, sql } = await fixture(); const h = harness(sql); let tree: any;
  try {
    const repo = new DailyEntries(sql, randomUUID); let day = await repo.getOrCreate('2026-10-26'); day = await repo.patch(day.entry_id, day.revision, { weight_kg: 72 });
    const { DailyForm } = h.load('ui/DailyForm.tsx'); const ref = h.React.createRef(); const props = { database: sql, initialDate: day.entry_date, ref };
    await h.act(async () => { tree = h.create(h.React.createElement(DailyForm, props)); }); await press(h, tree, 'Temps de travail');
    await h.act(async () => input(tree, 'Heure de début').props.onChangeText('08:'));
    await h.act(async () => tree.unmount()); await h.act(async () => { tree = h.create(h.React.createElement(DailyForm, props)); });
    assert.match(label(tree.root), /Brouillon retrouvé/); await press(h, tree, 'Terminer Temps de travail');
    assert.equal(input(tree, 'Heure de début').props.value, '08:'); assert.equal(ref.current.hasUnconfirmed(), true); await assert.rejects(ref.current.beforeReplace());
    assert.equal((await repo.read(day.entry_id)).work_start_time, null);
    await h.act(async () => input(tree, 'Heure de début').props.onChangeText('08:48')); await press(h, tree, 'Continuer →');
    assert.equal((await repo.read(day.entry_id)).work_start_time, '08:48'); assert.equal((await repo.read(day.entry_id)).weight_kg, 72);
    assert.equal(native.prepare("SELECT count(*) AS n FROM settings WHERE key LIKE 'draft.daily.%'").get()!.n, 0);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('a valid unconfirmed intent is persisted before the failed write and requires explicit comparison after restart', async () => {
  const { native, sql } = await fixture(); let fail = true, tree: any;
  const repo = new DailyEntries(sql, randomUUID); const day = await repo.getOrCreate('2026-10-26'); await repo.patch(day.entry_id, day.revision, { weight_kg: 71 });
  const port = { ...sql, getFirstAsync: async <T>(s: string, ...p: BindValue[]) => {
    if (fail && s.startsWith('UPDATE daily_entries SET weight_kg')) throw new Error('Synthetic write interrupted');
    return sql.getFirstAsync<T>(s, ...p);
  } }; const h = harness(port);
  try {
    const { DailyForm } = h.load('ui/DailyForm.tsx'); const ref = h.React.createRef(); const props = { database: port, initialDate: day.entry_date, ref };
    await h.act(async () => { tree = h.create(h.React.createElement(DailyForm, props)); }); await press(h, tree, 'Poids');
    await h.act(async () => input(tree, 'Poids (kg)').props.onChangeText('72'));
    assert.equal((await repo.read(day.entry_id)).weight_kg, 71);
    assert.equal(native.prepare("SELECT count(*) AS n FROM settings WHERE key LIKE 'draft.daily.%'").get()!.n, 1);
    await h.act(async () => tree.unmount()); fail = false;
    await h.act(async () => { tree = h.create(h.React.createElement(DailyForm, props)); });
    assert.equal(ref.current.hasUnconfirmed(), true); await assert.rejects(ref.current.beforeReplace());
    assert.equal((await repo.read(day.entry_id)).weight_kg, 71); // No automatic replay.
    await press(h, tree, 'Comparer le brouillon retrouvé aux valeurs enregistrées'); assert.match(label(tree.root), /Enregistré : 71 · Brouillon : 72/);
    await press(h, tree, 'Garder la valeur enregistrée'); await press(h, tree, 'Appliquer mes choix');
    assert.equal(ref.current.hasUnconfirmed(), false); await press(h, tree, 'Poids');
    assert.equal(input(tree, 'Poids (kg)').props.value, '71'); assert.equal((await repo.read(day.entry_id)).weight_kg, 71);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('rapid edits keep the latest intent and a failed journal write never falsely confirms a business save', async () => {
  const { native, sql } = await fixture(); let fail = true, tree: any;
  const port = { ...sql, runAsync: async (s: string, ...p: BindValue[]) => {
    if (fail && s.startsWith('INSERT INTO settings') && String(p[0]).startsWith('draft.')) throw new Error('Synthetic journal unavailable');
    return sql.runAsync(s, ...p);
  } }; const h = harness(port);
  try {
    const { DailyForm } = h.load('ui/DailyForm.tsx'); const ref = h.React.createRef();
    await h.act(async () => { tree = h.create(h.React.createElement(DailyForm, { database: port, initialDate: '2026-10-26', ref })); }); await press(h, tree, 'Poids');
    await h.act(async () => input(tree, 'Poids (kg)').props.onChangeText('72'));
    assert.equal(ref.current.hasUnconfirmed(), true); await assert.rejects(ref.current.beforeReplace());
    assert.equal(native.prepare('SELECT weight_kg FROM daily_entries').get()!.weight_kg, null);
    assert.doesNotMatch(label(tree.root), /Valeurs enregistrées localement/);
    fail = false; await press(h, tree, 'Réessayer la conservation des brouillons');
    await h.act(async () => { const callback = input(tree, 'Poids (kg)').props.onChangeText; callback('73'); callback('74'); });
    await ref.current.settle(); assert.equal(native.prepare('SELECT weight_kg FROM daily_entries').get()!.weight_kg, 74);
    assert.equal(input(tree, 'Poids (kg)').props.value, '74'); assert.equal(ref.current.hasUnconfirmed(), false);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('several incomplete sections remain reachable after restart without clearing their other buffers', async () => {
  const { native, sql } = await fixture(); const h = harness(sql); let tree: any;
  try {
    const store = new DailyBuffers(sql, '2026-10-26', randomUUID); await store.read();
    await store.stage('work_start_time', { value: '08:' }); await store.stage('phone_minutes', { hours: '1', minutes: '2,' });
    const { DailyForm } = h.load('ui/DailyForm.tsx'); const ref = h.React.createRef();
    await h.act(async () => { tree = h.create(h.React.createElement(DailyForm, { database: sql, initialDate: '2026-10-26', ref })); });
    await press(h, tree, 'Terminer Temps de travail'); assert.equal(input(tree, 'Heure de début').props.value, '08:');
    await press(h, tree, 'Terminer Temps de portable'); assert.equal(input(tree, 'Temps de portable · Minutes').props.value, '2,');
    await h.act(async () => input(tree, 'Temps de portable · Minutes').props.onChangeText('23'));
    await press(h, tree, 'Terminer Temps de travail'); assert.equal(input(tree, 'Heure de début').props.value, '08:');
    await h.act(async () => input(tree, 'Heure de début').props.onChangeText('08:48'));
    await ref.current.beforeReplace(); assert.equal(ref.current.hasUnconfirmed(), false);
    assert.equal(native.prepare('SELECT phone_minutes FROM daily_entries').get()!.phone_minutes, 83);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('choosing calculated sleep waits for a pending manual buffer before discarding only that old intent', async () => {
  const { native, sql } = await fixture(); const h = harness(sql); let tree: any;
  try {
    const repo = new DailyEntries(sql, randomUUID); const day = await repo.getOrCreate('2026-10-26');
    await repo.patch(day.entry_id, day.revision, { sleep_bedtime: '23:00', sleep_wake_time: '07:00', sleep_duration_mode: 'manual' });
    const { DailyForm } = h.load('ui/DailyForm.tsx'); const ref = h.React.createRef();
    await h.act(async () => { tree = h.create(h.React.createElement(DailyForm, { database: sql, initialDate: day.entry_date, ref })); }); await press(h, tree, 'Sommeil');
    await h.act(async () => { input(tree, 'Durée du sommeil (heures)').props.onChangeText('7,'); button(tree, 'Utiliser la durée calculée').props.onPress(); });
    await ref.current.settle();
    assert.equal((await repo.read(day.entry_id)).sleep_hours, 8);
    assert.equal(native.prepare("SELECT count(*) AS n FROM settings WHERE key LIKE 'draft.daily.%'").get()!.n, 0);
    await h.act(async () => tree.unmount());
    await h.act(async () => { tree = h.create(h.React.createElement(DailyForm, { database: sql, initialDate: day.entry_date, ref })); });
    assert.equal(ref.current.hasUnconfirmed(), false); assert.doesNotMatch(label(tree.root), /Brouillon retrouvé/);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('a restore barrier started during loading still refuses the incomplete buffer discovered afterwards', async () => {
  const { native, sql } = await fixture(); let tree: any, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const store = new DailyBuffers(sql, '2026-10-26', randomUUID); await store.read(); await store.stage('work_start_time', { value: '08:' });
  const port = { ...sql, getAllAsync: async <T>(s: string, ...p: BindValue[]) => {
    if (s === 'SELECT key, value FROM settings WHERE key LIKE ?') await gate;
    return sql.getAllAsync<T>(s, ...p);
  } }; const h = harness(port);
  try {
    const { DailyForm } = h.load('ui/DailyForm.tsx'); const ref = h.React.createRef();
    await h.act(async () => { tree = h.create(h.React.createElement(DailyForm, { database: port, initialDate: '2026-10-26', ref })); });
    let settled = false; const barrier = ref.current.beforeReplace().then(() => { settled = true; return false; }, () => { settled = true; return true; });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false);
    let refused = false; await h.act(async () => { release(); refused = await barrier; });
    assert.equal(refused, true); assert.equal(ref.current.hasUnconfirmed(), true);
  } finally { release(); if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('failed cleanup after confirmed conflict choices never shows discarded input as saved and can finish locally', async () => {
  const { native, sql } = await fixture(); let fail = false, tree: any;
  const port = { ...sql, runAsync: async (s: string, ...p: BindValue[]) => {
    if (fail && s.startsWith('DELETE FROM settings')) throw new Error('Synthetic cleanup interrupted');
    return sql.runAsync(s, ...p);
  } }; const h = harness(port);
  try {
    const repo = new DailyEntries(sql, randomUUID); const day = await repo.getOrCreate('2026-10-26');
    const { DailyForm } = h.load('ui/DailyForm.tsx'); const ref = h.React.createRef();
    await h.act(async () => { tree = h.create(h.React.createElement(DailyForm, { database: port, initialDate: day.entry_date, ref })); }); await press(h, tree, 'Poids');
    await repo.patch(day.entry_id, day.revision, { weight_kg: 71 });
    await h.act(async () => input(tree, 'Poids (kg)').props.onChangeText('72'));
    await press(h, tree, 'Comparer le brouillon aux valeurs enregistrées');
    await press(h, tree, 'Garder la valeur enregistrée'); fail = true; await press(h, tree, 'Appliquer mes choix');
    assert.equal(input(tree, 'Poids (kg)').props.value, '71'); assert.equal((await repo.read(day.entry_id)).weight_kg, 71);
    assert.doesNotMatch(label(tree.root), /Valeurs enregistrées localement/);
    assert.equal(ref.current.hasUnconfirmed(), true); await assert.rejects(ref.current.beforeReplace());
    const revision = (await repo.read(day.entry_id)).revision;
    fail = false; await press(h, tree, 'Réessayer la conservation des brouillons');
    assert.equal(ref.current.hasUnconfirmed(), false); assert.equal((await repo.read(day.entry_id)).revision, revision);
    assert.match(label(tree.root), /Valeurs enregistrées localement/);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});
