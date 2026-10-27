import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { DailyEntries } from '../src/storage/dailyEntries.ts';
import { CheckinPositions } from '../src/storage/checkinPosition.ts';
import { SportSessions } from '../src/storage/sportSessions.ts';
import { resolveSportDraft } from '../src/storage/sportRecovery.ts';
import { resolveDailyDraft } from '../src/storage/dailyRecovery.ts';
import { migrate, type BindValue } from '../src/storage/migrations.ts';
import type { QueryConnection } from '../src/storage/catalogs.ts';

const { harness, press, input, label, button } = createRequire(import.meta.url)('./helpers/reactHarness.cjs');
const migrations = JSON.parse(readFileSync('src/storage/generated/migrations.json', 'utf8'));
async function fixture() {
  const native = new DatabaseSync(':memory:');
  const sql: QueryConnection = {
    execAsync: async statement => { native.exec(statement); },
    getFirstAsync: async <T>(statement: string, ...params: BindValue[]) => native.prepare(statement).get(...params) as T ?? null,
    getAllAsync: async <T>(statement: string, ...params: BindValue[]) => native.prepare(statement).all(...params) as T[],
    runAsync: async (statement, ...params) => ({ changes: Number(native.prepare(statement).run(...params).changes) }),
  };
  await migrate(sql, migrations); const daily = new DailyEntries(sql, randomUUID);
  const day = await daily.getOrCreate('2026-10-26'); return { native, sql, daily, day };
}
async function choose(h: any, tree: any, name: string) {
  const node = tree.root.findAllByType('Pressable').find((item: any) => item.props.accessibilityLabel === name);
  assert.ok(node, name); assert.ok(!node.props.disabled); await h.act(async () => node.props.onPress());
}

test('sport resolution applies explicit choices only and refuses stale decisions even when keeping only database values', async () => {
  const { native, sql, day } = await fixture();
  try {
    const repo = new SportSessions(sql, randomUUID);
    let row = await repo.getOrCreate(day.entry_id, 1);
    row = await repo.patch(row.session_id, row.revision, { sport_type: 'Course', distance_km: 8, duration_minutes: 40 });
    const result = await resolveSportDraft(repo, row, { distance_km: 5, duration_minutes: 90 }, ['distance_km']);
    assert.equal(result.snapshot.distance_km, 5); assert.equal(result.snapshot.duration_minutes, 40);
    assert.equal(result.snapshot.sport_type, 'Course');
    await assert.rejects(resolveSportDraft(repo, row, { distance_km: 3 }, []));
    await assert.rejects(resolveSportDraft(repo, result.snapshot, { distance_km: 3 }, ['duration_minutes']));
    await assert.rejects(resolveSportDraft(repo, result.snapshot, { distance_km: 3 }, ['distance_km', 'distance_km']));
    const unchanged = await resolveSportDraft(repo, result.snapshot, { distance_km: 3 }, []);
    assert.equal(unchanged.snapshot.revision, result.snapshot.revision);
  } finally { native.close(); }
});

test('real sport editor resolves a conflict while retaining incomplete input, other slots and body measures', async () => {
  const { native, sql, daily, day } = await fixture(); const h = harness(sql); let tree: any;
  try {
    await daily.patch(day.entry_id, day.revision, { weight_kg: 72 });
    const repo = new SportSessions(sql, randomUUID); const first = await repo.getOrCreate(day.entry_id, 1);
    await repo.patch(first.session_id, first.revision, { sport_type: 'Course', duration_minutes: 60 });
    const second = await repo.getOrCreate(day.entry_id, 2); await repo.patch(second.session_id, second.revision, { duration_minutes: 23 });
    const { SportForm } = h.load('ui/SportForm.tsx'); const ref = h.React.createRef();
    await h.act(async () => { tree = h.create(h.React.createElement(SportForm, { database: sql, entryId: day.entry_id, ref })); });
    let current = await repo.read(first.session_id); await repo.patch(current.session_id, current.revision, { duration_minutes: 40, distance_km: 8 });
    await h.act(async () => input(tree, 'Séance 1 · Distance (km)').props.onChangeText('5'));
    await h.act(async () => input(tree, 'Séance 1 · Heures').props.onChangeText('1,'));
    await press(h, tree, 'Comparer la séance 1 aux valeurs enregistrées');
    assert.equal(input(tree, 'Séance 1 · Distance (km)').props.editable, false);
    assert.equal(button(tree, 'Appliquer les choix de cette séance').props.disabled, true);
    await choose(h, tree, 'Séance 1 · Distance (km) · Garder mon brouillon');
    await press(h, tree, 'Appliquer les choix de cette séance');
    current = await repo.read(first.session_id); assert.equal(current.distance_km, 5); assert.equal(current.duration_minutes, 40);
    assert.equal(input(tree, 'Séance 1 · Heures').props.value, '1,');
    await h.act(async () => { await assert.rejects(ref.current.flush()); });
    await h.act(async () => input(tree, 'Séance 1 · Heures').props.onChangeText('1'));
    await h.act(async () => { await ref.current.flush(); }); assert.equal(ref.current.hasUnconfirmed(), false);
    assert.equal((await repo.read(second.session_id)).duration_minutes, 23);
    assert.equal((await daily.read(day.entry_id)).weight_kg, 72);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('a second sport conflict preserves the original draft and comparison can reload and accept database value', async () => {
  const { native, sql, day } = await fixture(); const h = harness(sql); let tree: any;
  try {
    const { SportForm } = h.load('ui/SportForm.tsx'); const ref = h.React.createRef();
    await h.act(async () => { tree = h.create(h.React.createElement(SportForm, { database: sql, entryId: day.entry_id, ref })); });
    const repo = new SportSessions(sql, randomUUID); let current = await repo.getOrCreate(day.entry_id, 1);
    current = await repo.patch(current.session_id, current.revision, { distance_km: 8 });
    await h.act(async () => input(tree, 'Séance 1 · Distance (km)').props.onChangeText('5'));
    await press(h, tree, 'Comparer la séance 1 aux valeurs enregistrées');
    await choose(h, tree, 'Séance 1 · Distance (km) · Garder mon brouillon');
    await repo.patch(current.session_id, current.revision, { distance_km: 9 });
    await press(h, tree, 'Appliquer les choix de cette séance');
    assert.match(label(tree.root), /brouillon initial est conservé/);
    assert.equal(input(tree, 'Séance 1 · Distance (km)').props.value, '5');
    assert.equal((await repo.read(current.session_id)).distance_km, 9);
    await press(h, tree, 'Relire la comparaison de cette séance');
    await choose(h, tree, 'Séance 1 · Distance (km) · Garder la valeur enregistrée');
    await press(h, tree, 'Appliquer les choix de cette séance');
    assert.equal(input(tree, 'Séance 1 · Distance (km)').props.value, '9');
    await ref.current.flush(); assert.equal(ref.current.hasUnconfirmed(), false);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('stale navigation position is explicitly reread without resetting step, partial raw input or saved progress', async () => {
  const { native, sql, daily, day } = await fixture(); const h = harness(sql); let tree: any;
  try {
    const { DailyForm } = h.load('ui/DailyForm.tsx');
    await h.act(async () => { tree = h.create(h.React.createElement(DailyForm, { database: sql, initialDate: day.entry_date })); });
    await press(h, tree, 'Temps de travail');
    await h.act(async () => input(tree, 'Heure de début').props.onChangeText('08:48'));
    const positions = new CheckinPositions(sql); const cursor = await positions.read(day.entry_date);
    await positions.move(day.entry_date, cursor.revision, 'sport');
    await press(h, tree, 'Continuer →'); assert.match(label(tree.root), /position de saisie a changé/);
    await h.act(async () => input(tree, 'Fin de matinée').props.onChangeText('12:'));
    await press(h, tree, 'Relire la position sans perdre mes saisies');
    assert.equal(input(tree, 'Fin de matinée').props.value, '12:');
    assert.equal((await daily.read(day.entry_id)).work_start_time, '08:48');
    assert.ok(String((await daily.read(day.entry_id)).completed_steps).includes('work'));
    await h.act(async () => input(tree, 'Fin de matinée').props.onChangeText('12:30'));
    await press(h, tree, 'Continuer →'); assert.match(label(tree.root), /Séance 1/);
    await h.back(); assert.equal(input(tree, 'Heure de début').props.value, '08:48');
    assert.equal(input(tree, 'Fin de matinée').props.value, '12:30');
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('daily resolution also rejects a second conflict when every choice keeps database values', async () => {
  const { native, daily, day } = await fixture();
  try {
    await daily.patch(day.entry_id, day.revision, { weight_kg: 72 });
    await assert.rejects(resolveDailyDraft(daily, day, { weight_kg: 70 }, []));
    assert.equal((await daily.read(day.entry_id)).weight_kg, 72);
  } finally { native.close(); }
});
