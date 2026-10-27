import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { migrate, type BindValue } from '../src/storage/migrations.ts';
import { DailyEntries } from '../src/storage/dailyEntries.ts';
import { Catalogs, type QueryConnection } from '../src/storage/catalogs.ts';
import { Journals } from '../src/storage/journals.ts';
import { readCatalogHistory } from '../src/storage/catalogHistory.ts';
import { recurrence, roundInterval } from '../src/domain/catalogHistory.ts';
import { shiftDate } from '../src/domain/dates.ts';

const { harness, press, input, label, button, visible } = createRequire(import.meta.url)('./helpers/reactHarness.cjs');
const migrations = JSON.parse(readFileSync('src/storage/generated/migrations.json', 'utf8'));
const cases = JSON.parse(readFileSync('tests/fixtures/catalog_history.json', 'utf8'));
async function fixture() {
  const native = new DatabaseSync(':memory:');
  const sql: QueryConnection = {
    execAsync: async statement => { native.exec(statement); },
    getFirstAsync: async <T>(statement: string, ...params: BindValue[]) => native.prepare(statement).get(...params) as T ?? null,
    getAllAsync: async <T>(statement: string, ...params: BindValue[]) => native.prepare(statement).all(...params) as T[],
    runAsync: async (statement, ...params) => ({ changes: Number(native.prepare(statement).run(...params).changes) }),
  };
  await migrate(sql, migrations);
  const daily = new DailyEntries(sql, randomUUID), people = new Catalogs(sql, randomUUID, 'friends'), goals = new Catalogs(sql, randomUUID, 'goals');
  return { native, sql, daily, people, goals };
}

test('recurrence matches shared V1 fixtures including leap year, Paris clock changes, one observation and binary rounding', () => {
  for (const item of cases.rounding) assert.equal(roundInterval(item.value), item.expected);
  for (const item of cases.recurrence) assert.deepEqual(recurrence(item.dates[0], item.dates.at(-1), item.dates.length, item.end), { daysSince: item.daysSince, averageInterval: item.averageInterval });
  assert.deepEqual(recurrence(null, null, 0, '2026-10-27'), { daysSince: null, averageInterval: null });
  assert.throws(() => recurrence('2026-10-28', '2026-10-28', 1, '2026-10-27'));
  assert.throws(() => recurrence('2026-10-01', '2026-10-02', 3, '2026-10-27'));
});

test('read-only social history keeps homonyms separate, includes archives and excludes future/deselected entries from recurrence', async () => {
  const { native, sql, daily, people } = await fixture();
  try {
    const a = await people.create('Homonyme fictif', 'Ami'), b = await people.create('Homonyme fictif', 'Famille');
    for (const [date, id, included] of [['2026-10-01', a, true], ['2026-10-10', a, true], ['2026-10-25', a, false], ['2026-10-20', b, true], ['2026-10-30', a, true]] as const) {
      const day = await daily.getOrCreate(date); const log = await people.select(day.entry_id, id);
      if (!included) { await new Journals(sql, 'friends').patch(log.id, log.revision, { note: 'Note décochée fictive', duration_minutes: 0 }); await people.deselect((await people.logs(day.entry_id))[0]!); }
    }
    await people.setActive((await people.list()).find(item => item.id === a)!, false);
    const before = native.prepare('SELECT total_changes() AS n').get()!.n;
    const report = await readCatalogHistory(sql, 'friends', '2026-10-27', 'all');
    assert.equal(report.statistics.length, 2); const first = report.statistics.find(item => item.id === a)!;
    assert.equal(first.count, 2); assert.equal(first.tracked_days, 3); assert.equal(first.active, 0); assert.equal(first.averageInterval, 9); assert.equal(first.daysSince, 17);
    assert.equal(report.statistics.find(item => item.id === b)!.count, 1);
    assert.equal(report.logs.length, 3); assert.equal(report.periods.reduce((sum, item) => sum + item.interactions, 0), 3);
    const withUncounted = await readCatalogHistory(sql, 'friends', '2026-10-27', 'all', { includeUncounted: true, subject: a });
    assert.equal(withUncounted.logs.length, 3); assert.equal(withUncounted.logs[0]!.duration_minutes, 0); assert.equal(withUncounted.logs[0]!.counted, 0);
    assert.equal(withUncounted.logs[0]!.note, 'Note décochée fictive');
    assert.equal(native.prepare('SELECT total_changes() AS n').get()!.n, before);
  } finally { native.close(); }
});

test('goal history distinguishes tracked/unworked from contributions and preserves present completion status', async () => {
  const { native, sql, daily, goals } = await fixture();
  try {
    const id = await goals.create('Objectif fictif');
    for (const [date, worked] of [['2026-10-01', false], ['2026-10-10', true]] as const) {
      const day = await daily.getOrCreate(date), log = await goals.select(day.entry_id, id);
      if (!worked) { await goals.deselect(log); const row = await new Journals(sql, 'goals').read(log.id); await new Journals(sql, 'goals').patch(log.id, row.revision, { note: 'Note conservée sans travail' }); }
    }
    await goals.setCompleted((await goals.list())[0]!, true);
    const report = await readCatalogHistory(sql, 'goals', '2026-10-27', 'all');
    assert.equal(report.statistics[0]!.count, 1); assert.equal(report.statistics[0]!.tracked_days, 2); assert.ok(report.statistics[0]!.completed_at);
    assert.equal(report.logs.length, 2); assert.equal(report.logs[1]!.counted, 0); assert.equal(report.logs[1]!.note, 'Note conservée sans travail');
    assert.equal((await readCatalogHistory(sql, 'goals', '2026-10-27', 'all', { includeUncounted: false })).logs.length, 1);
  } finally { native.close(); }
});

test('pagination exposes all records once and caps free-text loading to 21 records per request', async () => {
  const { native, sql, daily, people } = await fixture();
  try {
    const first = await people.create('Personne 00 fictive');
    for (let i = 1; i < 25; i++) await people.create(`Personne ${String(i).padStart(2, '0')} fictive`);
    for (let i = 0; i < 45; i++) { const day = await daily.getOrCreate(shiftDate('2026-08-01', i)); await people.select(day.entry_id, first); }
    const ids: string[] = [], subjects: string[] = []; const statements: string[] = [];
    const observed = { ...sql, getAllAsync: async <T>(statement: string, ...params: BindValue[]) => { statements.push(statement); return sql.getAllAsync<T>(statement, ...params); } };
    for (let page = 0; page < 3; page++) { const report = await readCatalogHistory(observed, 'friends', '2026-10-27', 'all', { logsPage: page }); assert.ok(report.logs.length <= 20); ids.push(...report.logs.map(item => item.id)); }
    for (let page = 0; page < 2; page++) subjects.push(...(await readCatalogHistory(sql, 'friends', '2026-10-27', 'all', { statisticsPage: page })).statistics.map(item => item.id));
    assert.equal(ids.length, 45); assert.equal(new Set(ids).size, 45); assert.equal(new Set(subjects).size, 25);
    assert.ok(statements.filter(sql => sql.includes('l.note')).every(sql => sql.includes('LIMIT ? OFFSET ?')));
    assert.ok(statements.filter(sql => sql.includes('GROUP BY s.')).every(sql => !sql.includes('l.note')));
    await assert.rejects(readCatalogHistory(sql, 'friends', '2026-10-27', 'all', { logsPage: -1 }));
    assert.equal((await readCatalogHistory(sql, 'friends', '2026-10-27', 'week')).logs.length, 0);
  } finally { native.close(); }
});

test('real history panel filters a person and non-counted entries, preserves controls through failure and ignores late responses', async () => {
  const { native, sql, daily, people } = await fixture(); let tree: any, fail = false;
  const id = await people.create('Personne fictive'); const day = await daily.getOrCreate('2026-10-26'); const log = await people.select(day.entry_id, id);
  await new Journals(sql, 'friends').patch(log.id, log.revision, { note: 'Note historique fictive' });
  await people.deselect((await people.logs(day.entry_id))[0]!);
  let release!: () => void, once = true;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const delayed = { ...sql, getAllAsync: async <T>(statement: string, ...params: BindValue[]) => {
    if (statement.includes('GROUP BY s.')) { if (once) { once = false; await gate; throw new Error('late synthetic'); } if (fail) throw new Error('synthetic'); }
    return sql.getAllAsync<T>(statement, ...params);
  } };
  const h = harness(delayed);
  try {
    const { CatalogHistory } = h.load('ui/CatalogHistory.tsx');
    await h.act(async () => { tree = h.create(h.React.createElement(CatalogHistory, { database: delayed, kind: 'friends', date: '2026-10-27' })); });
    await press(h, tree, '7 jours'); await h.act(async () => release()); assert.ok(!label(tree.root).includes('Historique indisponible'));
    await press(h, tree, 'Voir ce journal'); await press(h, tree, 'Inclure les entrées non comptées');
    await press(h, tree, 'Lire les détails du 26/10/2026 · Personne fictive'); assert.match(label(tree.root), /Note historique fictive/);
    fail = true; await press(h, tree, 'Actualiser cet historique'); assert.match(label(tree.root), /Historique indisponible/);
    assert.equal(button(tree, '7 jours').props.accessibilityState.selected, true);
    fail = false; await press(h, tree, 'Réessayer cet historique'); assert.match(label(tree.root), /Filtre : Personne fictive/);
    assert.equal(button(tree, 'Inclure les entrées non comptées').props.accessibilityState.checked, true);
  } finally { release(); if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('catalog/history tabs retain an unfinished add and opening from Bilan preserves its historical context on Back', async () => {
  const { native, sql } = await fixture(); const h = harness(sql); let tree: any;
  try {
    const { CatalogScreen } = h.load('ui/CatalogScreen.tsx');
    await h.act(async () => { tree = h.create(h.React.createElement(CatalogScreen, { database: sql, kind: 'friends', onDone() {}, date: '2026-10-26' })); });
    await h.act(async () => input(tree, 'Nom de la personne').props.onChangeText('Ajout inachevé'));
    await press(h, tree, 'Historique et récurrence'); assert.match(label(tree.root), /brouillon reste conservé/);
    await press(h, tree, 'Répertoire'); assert.equal(input(tree, 'Nom de la personne').props.value, 'Ajout inachevé');
    await h.act(async () => tree.unmount()); tree = undefined;
    native.prepare('INSERT INTO settings (key,value,updated_at) VALUES (?,?,?)').run('onboarding.v1', JSON.stringify({ version: 1, revision: 1, step: 'review', completed: true, dataChoice: 'existing' }), new Date().toISOString());
    const App = h.load('App.tsx').default;
    await h.act(async () => { tree = h.create(h.React.createElement(App)); });
    await h.act(async () => input(tree, 'Date de l’historique').props.onChangeText('2026-10-26'));
    await press(h, tree, 'Ouvrir cette journée'); await press(h, tree, 'Bilan', 'tab');
    await press(h, tree, 'Social'); await press(h, tree, 'Historique social détaillé');
    const text = tree.root.findAllByType('Text').filter(visible).map(label).join(' '); assert.match(text, /Situation des activités au 26\/10\/2026/);
    await h.back(); assert.ok(button(tree, 'Historique social détaillé')); assert.equal(button(tree, '1 mois').props.accessibilityState.selected, true);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});
