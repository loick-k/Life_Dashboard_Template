import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { migrate, type BindValue } from '../src/storage/migrations.ts';
import type { QueryConnection } from '../src/storage/catalogs.ts';

const { harness, press, input, label } = createRequire(import.meta.url)('./helpers/reactHarness.cjs');
async function fixture() {
  const native = new DatabaseSync(':memory:');
  const sql: QueryConnection = {
    execAsync: async s => { native.exec(s); },
    getFirstAsync: async <T>(s: string, ...p: BindValue[]) => native.prepare(s).get(...p) as T ?? null,
    getAllAsync: async <T>(s: string, ...p: BindValue[]) => native.prepare(s).all(...p) as T[],
    runAsync: async (s, ...p) => ({ changes: Number(native.prepare(s).run(...p).changes) }),
  };
  await migrate(sql, JSON.parse(readFileSync('src/storage/generated/migrations.json', 'utf8')));
  return { native, sql };
}
function clock(initial: string) {
  const RealDate = globalThis.Date; let now = initial;
  globalThis.Date = new Proxy(RealDate, {
    construct: (target, args) => Reflect.construct(target, args.length ? args : [now]),
    get: (target, key) => key === 'now' ? () => new RealDate(now).getTime() : Reflect.get(target, key),
  });
  return { move(value: string) { now = value; }, restore() { globalThis.Date = RealDate; } };
}

test('Today and Yesterday resolve Paris dates at the actual press, without an intermediate render', async () => {
  for (const sample of [
    { before: '2026-03-28T22:50:00Z', after: '2026-03-29T08:00:00Z', today: '2026-03-29', yesterday: '2026-03-28' },
    { before: '2026-10-24T21:50:00Z', after: '2026-10-25T08:00:00Z', today: '2026-10-25', yesterday: '2026-10-24' },
  ]) {
    const fake = clock(sample.before); const { native, sql } = await fixture(); const h = harness(sql); let tree: any;
    try {
      const { DailyForm } = h.load('ui/DailyForm.tsx');
      await h.act(async () => { tree = h.create(h.React.createElement(DailyForm, { database: sql })); });
      fake.move(sample.after); await press(h, tree, 'Aujourd’hui');
      assert.ok(tree.root.findAllByType('Text').some((n: any) => label(n) === sample.today));
      await press(h, tree, 'Hier');
      assert.ok(tree.root.findAllByType('Text').some((n: any) => label(n) === sample.yesterday));
    } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); fake.restore(); }
  }
});

test('resuming after midnight updates the Paris reference, not the chosen day or an unfinished clock', async () => {
  const fake = clock('2026-10-26T22:50:00Z'); const { native, sql } = await fixture(); const h = harness(sql); let tree: any;
  try {
    const { DailyForm } = h.load('ui/DailyForm.tsx');
    await h.act(async () => { tree = h.create(h.React.createElement(DailyForm, { database: sql })); });
    await press(h, tree, 'Temps de travail');
    await h.act(async () => input(tree, 'Heure de début').props.onChangeText('08:'));
    await h.appState('background'); fake.move('2026-10-27T08:00:00Z'); await h.appState('active');
    assert.match(label(tree.root), /Aujourd’hui à Paris : 27\/10\/2026/);
    assert.equal(input(tree, 'Heure de début').props.value, '08:');
    assert.equal(native.prepare('SELECT entry_date FROM daily_entries').get()!.entry_date, '2026-10-26');
    await press(h, tree, 'Aujourd’hui'); assert.equal(input(tree, 'Heure de début').props.value, '08:');
    await h.act(async () => input(tree, 'Heure de début').props.onChangeText('08:48'));
    await press(h, tree, 'Aujourd’hui');
    assert.equal(native.prepare('SELECT work_start_time FROM daily_entries WHERE entry_date=?').get('2026-10-26')!.work_start_time, '08:48');
    assert.equal(native.prepare('SELECT work_start_time FROM daily_entries WHERE entry_date=?').get('2026-10-27')!.work_start_time, null);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); fake.restore(); }
});

test('the current weekly assessment advances on resume while the historical Bilan selection stays unchanged', async () => {
  const fake = clock('2026-10-25T22:50:00Z'); const { native, sql } = await fixture(); const h = harness(sql); let tree: any;
  try {
    const { WorkBilan } = h.load('ui/WorkBilan.tsx');
    await h.act(async () => { tree = h.create(h.React.createElement(WorkBilan, { database: sql, initialDate: '2026-10-19', onDone() {} })); });
    await h.appState('background'); fake.move('2026-10-26T08:00:00Z'); await h.appState('active');
    assert.match(label(tree.root), /Du 26\/10\/2026 au 26\/10\/2026/);
    assert.match(label(tree.root), /jusqu’au 19\/10\/2026/);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); fake.restore(); }
});
