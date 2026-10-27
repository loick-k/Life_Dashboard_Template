import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { migrate, type BindValue } from '../src/storage/migrations.ts';
import { DailyEntries } from '../src/storage/dailyEntries.ts';
import { CheckinPositions } from '../src/storage/checkinPosition.ts';
import { Preferences } from '../src/storage/preferences.ts';
import { initialNavigation, navigateMain } from '../src/domain/navigation.ts';
import { resolveDailyDraft } from '../src/storage/dailyRecovery.ts';
import { settleWrites } from '../src/storage/settleWrites.ts';
import type { QueryConnection } from '../src/storage/catalogs.ts';

const { harness, button, input, press, visible, label } = createRequire(import.meta.url)('./helpers/reactHarness.cjs');
const migrations = JSON.parse(readFileSync('src/storage/generated/migrations.json', 'utf8'));
async function fixture() {
  const native = new DatabaseSync(':memory:');
  const database: QueryConnection = {
    execAsync: async statement => { native.exec(statement); },
    getFirstAsync: async <T>(statement: string, ...params: BindValue[]) => native.prepare(statement).get(...params) as T ?? null,
    getAllAsync: async <T>(statement: string, ...params: BindValue[]) => native.prepare(statement).all(...params) as T[],
    runAsync: async (statement, ...params) => ({ changes: Number(native.prepare(statement).run(...params).changes) }),
  };
  await migrate(database, migrations);
  return { native, database };
}

test('navigation carries the edited date to Bilan without changing a retained daily draft', () => {
  let state = initialNavigation('2026-10-26');
  state = navigateMain(state, 'bilan'); assert.equal(state.bilanDate, '2026-10-26');
  state = { ...state, bilanDate: '2026-10-19' };
  state = navigateMain(state, 'settings'); state = navigateMain(state, 'bilan');
  assert.equal(state.bilanDate, '2026-10-19'); assert.equal(state.dailyDate, '2026-10-26');
  assert.deepEqual(state.visited, ['daily', 'bilan', 'settings']);
});

test('barriers await the other writes even when the first operation rejects', async () => {
  let release!: () => void, ended = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const operation = settleWrites([Promise.reject(new Error('synthetic')), gate]);
  void operation.catch(() => { ended = true; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(ended, false);
  release(); await assert.rejects(operation); assert.equal(ended, true);
});

test('daily resolution keeps only explicit choices, other values and a second conflict intact', async () => {
  const { native, database } = await fixture();
  try {
    const repo = new DailyEntries(database, randomUUID);
    let day = await repo.getOrCreate('2026-10-26');
    day = await repo.patch(day.entry_id, day.revision, { weight_kg: 70, work_start_time: '08:30' });
    const resolved = await resolveDailyDraft(repo, day, { weight_kg: 72, body_fat_pct: 19 }, ['body_fat_pct']);
    assert.equal(resolved.snapshot.weight_kg, 70); assert.equal(resolved.snapshot.body_fat_pct, 19);
    assert.equal(resolved.snapshot.work_start_time, '08:30');
    await assert.rejects(resolveDailyDraft(repo, day, { weight_kg: 74 }, ['weight_kg']));
    assert.equal((await repo.read(day.entry_id)).weight_kg, 70);
    await assert.rejects(resolveDailyDraft(repo, resolved.snapshot, { weight_kg: 75 }, ['work_start_time']));
  } finally { native.close(); }
});

test('Bilan rereads the cumulative counter and series after returning from daily edits', async () => {
  const { native, database } = await fixture(); const h = harness(database); let tree: any;
  try {
    const repo = new DailyEntries(database, randomUUID); let day = await repo.getOrCreate('2026-10-26');
    day = await repo.patch(day.entry_id, day.revision, { work_mode: 'Bureau', work_start_time: '08:00', work_end_time: '15:42', weight_kg: 70 });
    const { WorkBilan } = h.load('ui/WorkBilan.tsx');
    const props = { database, initialDate: day.entry_date, onDone() {} };
    await h.act(async () => { tree = h.create(h.React.createElement(WorkBilan, { ...props, active: true })); });
    assert.match(label(tree.root), /À l’équilibre/);
    await h.act(async () => tree.update(h.React.createElement(WorkBilan, { ...props, active: false })));
    await repo.patch(day.entry_id, day.revision, { work_end_time: '16:42', weight_kg: 71 });
    await h.act(async () => tree.update(h.React.createElement(WorkBilan, { ...props, active: true })));
    assert.match(label(tree.root), /\+1h00/); assert.match(label(tree.root), /71 kg/);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('sports settle waits for all initial writes, including after one failure, and loading can retry', async () => {
  const { native, database } = await fixture(); let tree: any;
  let release!: () => void, completed = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const delayed = { ...database, runAsync: async (sql: string, ...params: BindValue[]) => {
    if (sql.startsWith('INSERT INTO sport_sessions')) { if (params[2] === 1) throw new Error('synthetic'); await gate; completed++; }
    return database.runAsync(sql, ...params);
  } };
  const h = harness(delayed);
  try {
    const day = await new DailyEntries(database, randomUUID).getOrCreate('2026-10-26');
    const { SportForm } = h.load('ui/SportForm.tsx'); const ref = h.React.createRef();
    await h.act(async () => { tree = h.create(h.React.createElement(SportForm, { ref, database: delayed, entryId: day.entry_id })); });
    let settled = false; const settling = ref.current.settle().catch(() => { settled = true; });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false);
    await h.act(async () => { release(); await settling; }); assert.equal(completed, 2);
    assert.equal(ref.current.hasUnconfirmed(), true);
    delayed.runAsync = database.runAsync;
    await press(h, tree, 'Réessayer le chargement des séances');
    await ref.current.flush(); assert.equal(ref.current.hasUnconfirmed(), false);
  } finally { release(); if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('sports duration correction unblocks flush and explicit removal preserves another slot', async () => {
  const { native, database } = await fixture(); const h = harness(database); let tree: any;
  try {
    const day = await new DailyEntries(database, randomUUID).getOrCreate('2026-10-26');
    const { SportForm } = h.load('ui/SportForm.tsx'); const ref = h.React.createRef();
    await h.act(async () => { tree = h.create(h.React.createElement(SportForm, { ref, database, entryId: day.entry_id })); });
    await h.act(async () => input(tree, 'Séance 1 · Heures').props.onChangeText('11'));
    await h.act(async () => input(tree, 'Séance 1 · Minutes').props.onChangeText('30'));
    await h.act(async () => { await assert.rejects(ref.current.flush()); });
    await h.act(async () => input(tree, 'Séance 1 · Heures').props.onChangeText('1'));
    await ref.current.flush();
    assert.equal(native.prepare('SELECT duration_minutes FROM sport_sessions WHERE position = 1').get()!.duration_minutes, 90);
    await press(h, tree, 'Séance 2 · À renseigner +');
    await h.act(async () => input(tree, 'Séance 2 · Distance (km)').props.onChangeText('5,2'));
    await press(h, tree, 'Séance 1 · À renseigner −');
    // Reopen first card and remove it via the actual confirmation action.
    await press(h, tree, 'Séance 1 · À renseigner +');
    const remove = tree.root.findAllByType('Pressable').find((node: any) => visible(node) && label(node) === 'Supprimer cette séance');
    await h.act(async () => remove.props.onPress());
    await h.act(async () => h.alerts.at(-1).buttons.find((item: any) => item.text === 'Supprimer').onPress());
    await ref.current.flush();
    assert.equal(native.prepare('SELECT duration_minutes FROM sport_sessions WHERE position = 1').get()!.duration_minutes, null);
    assert.equal(native.prepare('SELECT distance_km FROM sport_sessions WHERE position = 2').get()!.distance_km, 5.2);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('preferences retry failed reading; retained invalid drafts can leave but cannot restore', async () => {
  const { native, database } = await fixture(); let fail = true, left = 0, tree: any;
  const port = { ...database, getFirstAsync: async <T>(sql: string, ...params: BindValue[]) => {
    if (fail) throw new Error('synthetic read'); return database.getFirstAsync<T>(sql, ...params);
  } }; const h = harness(port);
  try {
    const { PreferencesForm } = h.load('ui/PreferencesForm.tsx'); const ref = h.React.createRef();
    await h.act(async () => { tree = h.create(h.React.createElement(PreferencesForm, { ref, database: port, preserveOnNavigate: true, onDone() { left++; } })); });
    fail = false; await press(h, tree, 'Réessayer le chargement des réglages');
    await h.act(async () => input(tree, 'Sommeil cible min (h)').props.onChangeText('7,'));
    assert.equal(ref.current.hasUnconfirmed(), true); await assert.rejects(ref.current.beforeReplace());
    await press(h, tree, 'Retour'); assert.equal(left, 1);
    assert.equal(input(tree, 'Sommeil cible min (h)').props.value, '7,');
    assert.equal((await new Preferences(database).read('sleep_min_hours')).value, 7);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('daily direct access returns home, failed load retries and a revision conflict resolves explicitly', async () => {
  const { native, database } = await fixture(); const h = harness(database); let tree: any;
  try {
    const date = '2026-10-26'; let fail = true;
    const port = { ...database, getFirstAsync: async <T>(sql: string, ...params: BindValue[]) => {
      if (fail && sql === 'SELECT * FROM daily_entries WHERE entry_date = ?') throw new Error('synthetic');
      return database.getFirstAsync<T>(sql, ...params);
    } };
    const { DailyForm } = h.load('ui/DailyForm.tsx');
    await h.act(async () => { tree = h.create(h.React.createElement(DailyForm, { database: port, initialDate: date })); });
    fail = false; await press(h, tree, 'Réessayer le chargement de la journée');
    await press(h, tree, 'Poids'); await press(h, tree, '← Retour');
    assert.ok(button(tree, 'Poids')); await press(h, tree, 'Poids');
    const repo = new DailyEntries(database, randomUUID); const current = await repo.getOrCreate(date);
    await repo.patch(current.entry_id, current.revision, { weight_kg: 71, body_fat_pct: 19 });
    await h.act(async () => input(tree, 'Poids (kg)').props.onChangeText('72,4'));
    await press(h, tree, 'Comparer le brouillon aux valeurs enregistrées');
    assert.equal(button(tree, 'Appliquer mes choix').props.disabled, true);
    await press(h, tree, 'Garder mon brouillon'); await press(h, tree, 'Appliquer mes choix');
    assert.equal((await repo.read(current.entry_id)).weight_kg, 72.4);
    assert.equal((await repo.read(current.entry_id)).body_fat_pct, 19);
    assert.equal(input(tree, 'Poids (kg)').props.value, '72,4');
    await press(h, tree, 'Continuer →'); assert.match(label(tree.root), /Masse graisseuse/);
    await h.back(); assert.ok(input(tree, 'Poids (kg)'));
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('main menu stays usable after daily load error and retains incomplete work clocks across routes', async () => {
  const { native, database } = await fixture(); let fail = true, tree: any;
  await database.runAsync('INSERT INTO settings (key,value,updated_at) VALUES (?,?,?)', 'onboarding.v1', JSON.stringify({ version: 1, revision: 1, step: 'review', completed: true, dataChoice: 'existing' }), new Date().toISOString());
  const port = { ...database, getFirstAsync: async <T>(sql: string, ...params: BindValue[]) => {
    if (fail && sql === 'SELECT * FROM daily_entries WHERE entry_date = ?') throw new Error('synthetic');
    return database.getFirstAsync<T>(sql, ...params);
  } }; const h = harness(port, { pickFile: async () => ({ canceled: false, result: { exists: true, size: 20, text: async () => 'synthetic-encrypted-file' } }) });
  try {
    const App = h.load('App.tsx').default;
    await h.act(async () => { tree = h.create(h.React.createElement(App)); });
    await press(h, tree, 'Réglages', 'tab'); assert.ok(input(tree, 'Sommeil cible min (h)'));
    await h.back(); assert.ok(button(tree, 'Réessayer le chargement de la journée'));
    fail = false; await press(h, tree, 'Réessayer le chargement de la journée');
    await press(h, tree, 'Temps de travail');
    await h.act(async () => input(tree, 'Heure de début').props.onChangeText('08:48'));
    await h.act(async () => input(tree, 'Fin de matinée').props.onChangeText('12:'));
    await press(h, tree, 'Bilan', 'tab'); assert.match(label(tree.root), /brouillon non confirmé/);
    await press(h, tree, 'Saisie', 'tab');
    assert.equal(input(tree, 'Heure de début').props.value, '08:48');
    assert.equal(input(tree, 'Fin de matinée').props.value, '12:');
    const row = native.prepare('SELECT work_start_time,work_morning_end_time FROM daily_entries ORDER BY entry_date DESC').get()!;
    assert.equal(row.work_start_time, '08:48'); assert.equal(row.work_morning_end_time, null);
    await press(h, tree, 'Réglages', 'tab'); await press(h, tree, 'Sauvegarde et récupération');
    await h.act(async () => input(tree, 'Code de récupération').props.onChangeText('a'.repeat(64)));
    await press(h, tree, 'Restaurer un fichier avec son code');
    await h.act(async () => h.alerts.at(-1).buttons.find((item: any) => item.text === 'Restaurer').onPress());
    assert.match(label(tree.root), /Restauration bloquée/);
    assert.equal(native.prepare('SELECT work_start_time FROM daily_entries ORDER BY entry_date DESC').get()!.work_start_time, '08:48');
    await h.back(); await press(h, tree, 'Saisie', 'tab');
    assert.equal(input(tree, 'Fin de matinée').props.value, '12:');
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});
