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
import { FieldBuffers, type BufferKind } from '../src/storage/fieldBuffers.ts';
import { sportBuffers, sportBufferValue, type SportField } from '../src/storage/sportBuffers.ts';
import { DailyEntries } from '../src/storage/dailyEntries.ts';
import { SportSessions } from '../src/storage/sportSessions.ts';
import { captureSnapshot, restoreSnapshot } from '../src/storage/backupSnapshot.ts';
const { harness, press, input, label, button } = createRequire(import.meta.url)('./helpers/reactHarness.cjs');
const migrations = JSON.parse(readFileSync('src/storage/generated/migrations.json', 'utf8'));
const kinds: Record<SportField, BufferKind> = { sport_type: 'scalar', duration_minutes: 'duration', distance_km: 'scalar' };
function adapter(native: DatabaseSync): QueryConnection {
  return { execAsync: async s => { native.exec(s); },
    getFirstAsync: async <T>(s: string, ...p: BindValue[]) => native.prepare(s).get(...p) as T ?? null,
    getAllAsync: async <T>(s: string, ...p: BindValue[]) => native.prepare(s).all(...p) as T[],
    runAsync: async (s, ...p) => ({ changes: Number(native.prepare(s).run(...p).changes) }),
  };
}
async function fixture() {
  const native = new DatabaseSync(':memory:'); const sql = adapter(native); await migrate(sql, migrations);
  const day = await new DailyEntries(sql, randomUUID).getOrCreate('2026-10-26'); const sports = new SportSessions(sql, randomUUID);
  return { native, sql, day, sports };
}
async function choose(h: any, tree: any, name: string) {
  const node = tree.root.findAllByType('Pressable').find((n: any) => n.props.accessibilityLabel === name); assert.ok(node); await h.act(async () => node.props.onPress());
}

test('multi-field intent is staged atomically, survives file reopening and refuses stale editors without clearing newer tokens', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'life-sport-buffers-')); let native = new DatabaseSync(join(folder, 'synthetic.db'));
  try {
    let sql = adapter(native); await migrate(sql, migrations);
    const a = new FieldBuffers(sql, 'sport', 'synthetic-session', kinds, randomUUID), b = new FieldBuffers(sql, 'sport', 'synthetic-session', kinds, randomUUID);
    await a.read(); await b.read(); const all = a.prepare({ sport_type: { raw: { value: '' }, clear: true }, duration_minutes: { raw: { hours: '', minutes: '' }, clear: true }, distance_km: { raw: { value: '' }, clear: true } });
    await a.stage(all); assert.equal(native.prepare("SELECT count(*) AS n FROM settings WHERE key LIKE 'draft.editor.%'").get()!.n, 1);
    await assert.rejects(b.stage(b.prepare({ distance_km: { raw: { value: '7,2' } } })));
    const newer = a.prepare({ distance_km: { raw: { value: '8,4' } } }); await a.stage(newer);
    await a.confirm({ distance_km: all.distance_km!.token }); assert.equal(sportBufferValue('distance_km', a.records().distance_km!), 8.4);
    const before = a.records(); native.close(); native = new DatabaseSync(join(folder, 'synthetic.db')); sql = adapter(native);
    const store = new FieldBuffers(sql, 'sport', 'synthetic-session', kinds, randomUUID); assert.deepEqual(await store.read(), before);
    assert.equal(sportBufferValue('duration_minutes', before.duration_minutes!), null);
  } finally { native.close(); rmSync(folder, { recursive: true, force: true }); }
});

test('corrupt/future buffers are refused unchanged and invalid raw input never becomes a business write', async () => {
  const { native, sql } = await fixture();
  try {
    const key = 'draft.editor.v1:sport:synthetic-session'; await sql.runAsync('INSERT INTO settings VALUES (?,?,?)', key, '{"version":99}', '2026-10-27');
    await assert.rejects(new FieldBuffers(sql, 'sport', 'synthetic-session', kinds, randomUUID).read()); assert.equal(native.prepare('SELECT value FROM settings WHERE key=?').get(key)!.value, '{"version":99}');
    let writes = 0; const editor = sportBuffers(sql, 'other-session', randomUUID, () => {}); await editor.read({ duration_minutes: null, distance_km: null });
    await editor.submit({ duration_minutes: { raw: { hours: '1', minutes: '2,' } } }, async () => { writes++; return {}; });
    await editor.submit({ distance_km: { raw: { value: '201' } } }, async () => { writes++; return {}; });
    assert.equal(writes, 0); assert.equal(editor.invalid.size, 2); assert.equal(editor.hasUnconfirmed(), true);
  } finally { native.close(); }
});

test('cleanup retry never replays a confirmed writer and a superseded failed stage never overwrites the newest intent', async () => {
  const { native, sql } = await fixture(); let failCleanup = true, failStage = false, writes = 0;
  const port = { ...sql, runAsync: async (s: string, ...p: BindValue[]) => {
    if (failCleanup && s.startsWith('DELETE FROM settings') || failStage && s.startsWith('INSERT INTO settings')) throw new Error('Synthetic storage failure');
    return sql.runAsync(s, ...p);
  } };
  try {
    const editor = sportBuffers(port, 'synthetic-session', randomUUID, () => {}); await editor.read({ distance_km: null });
    let value: number | null = null; const write = async (patch: any) => { writes++; value = patch.distance_km; return { distance_km: value }; };
    await editor.submit({ distance_km: { raw: { value: '5,2' } } }, write); assert.equal(editor.storageFailed(), true); assert.equal(writes, 1);
    failCleanup = false; await editor.retry(); assert.equal(editor.hasUnconfirmed(), false); assert.equal(writes, 1);
    failStage = true; await editor.submit({ distance_km: { raw: { value: '6' } } }, write); assert.equal(editor.storageFailed(), true);
    failStage = false; await editor.submit({ distance_km: { raw: { value: '7' } } }, write); assert.equal(editor.storageFailed(), false);
    await editor.retry(); assert.equal(value, 7); assert.equal(writes, 2);
  } finally { native.close(); }
});

test('incomplete sport duration and distance are recovered on remount, other slots and weight remain intact', async () => {
  const { native, sql, day, sports } = await fixture(); const h = harness(sql); let tree: any;
  try {
    const daily = new DailyEntries(sql, randomUUID); await daily.patch(day.entry_id, day.revision, { weight_kg: 72 });
    const other = await sports.getOrCreate(day.entry_id, 2); await sports.patch(other.session_id, other.revision, { distance_km: 12 });
    const { SportForm } = h.load('ui/SportForm.tsx'); const ref = h.React.createRef(); const props = { database: sql, entryId: day.entry_id, ref };
    await h.act(async () => { tree = h.create(h.React.createElement(SportForm, props)); });
    await h.act(async () => input(tree, 'Séance 1 · Heures').props.onChangeText('1,'));
    await h.act(async () => input(tree, 'Séance 1 · Distance (km)').props.onChangeText('5,'));
    await h.act(async () => tree.unmount()); await h.act(async () => { tree = h.create(h.React.createElement(SportForm, props)); });
    assert.equal(input(tree, 'Séance 1 · Heures').props.value, '1,'); assert.equal(input(tree, 'Séance 1 · Distance (km)').props.value, '5,');
    assert.match(label(tree.root), /Brouillon sportif retrouvé/); await h.act(async () => { await assert.rejects(ref.current.flush()); });
    await h.act(async () => input(tree, 'Séance 1 · Heures').props.onChangeText('1'));
    await h.act(async () => input(tree, 'Séance 1 · Distance (km)').props.onChangeText('5,2')); await ref.current.flush();
    assert.equal((await sports.getOrCreate(day.entry_id, 1)).duration_minutes, 60); assert.equal((await sports.read(other.session_id)).distance_km, 12);
    assert.equal((await daily.read(day.entry_id)).weight_kg, 72); assert.equal(ref.current.hasUnconfirmed(), false);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('valid interrupted sport save requires comparison after restart; keeping database clears the intent without replay', async () => {
  const { native, sql, day, sports } = await fixture(); let fail = true, tree: any;
  const row = await sports.getOrCreate(day.entry_id, 1); await sports.patch(row.session_id, row.revision, { distance_km: 8 });
  const port = { ...sql, getFirstAsync: async <T>(s: string, ...p: BindValue[]) => {
    if (fail && s.startsWith('UPDATE sport_sessions')) throw new Error('Synthetic interrupted write'); return sql.getFirstAsync<T>(s, ...p);
  } }; const h = harness(port);
  try {
    const { SportForm } = h.load('ui/SportForm.tsx'); const ref = h.React.createRef(); const props = { database: port, entryId: day.entry_id, ref };
    await h.act(async () => { tree = h.create(h.React.createElement(SportForm, props)); }); await h.act(async () => input(tree, 'Séance 1 · Distance (km)').props.onChangeText('5,2'));
    await h.act(async () => tree.unmount()); fail = false; await h.act(async () => { tree = h.create(h.React.createElement(SportForm, props)); });
    assert.equal((await sports.read(row.session_id)).distance_km, 8); assert.equal(input(tree, 'Séance 1 · Distance (km)').props.value, '5,2');
    assert.equal(input(tree, 'Séance 1 · Distance (km)').props.editable, false); await h.act(async () => { await assert.rejects(ref.current.flush()); });
    await press(h, tree, 'Comparer la séance 1 aux valeurs enregistrées'); await choose(h, tree, 'Séance 1 · Distance (km) · Garder la valeur enregistrée'); await press(h, tree, 'Appliquer les choix de cette séance');
    assert.equal(input(tree, 'Séance 1 · Distance (km)').props.value, '8'); assert.equal(ref.current.hasUnconfirmed(), false);
    assert.equal(native.prepare("SELECT count(*) AS n FROM settings WHERE key LIKE 'draft.editor.%'").get()!.n, 0);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('removing a session persists all three clears as one intent before business SQL and leaves other sessions untouched', async () => {
  const { native, sql, day, sports } = await fixture(); let fail = true, tree: any;
  const first = await sports.getOrCreate(day.entry_id, 1); await sports.patch(first.session_id, first.revision, { sport_type: 'Course', duration_minutes: 90, distance_km: 15 });
  const second = await sports.getOrCreate(day.entry_id, 2); await sports.patch(second.session_id, second.revision, { distance_km: 23 });
  const port = { ...sql, getFirstAsync: async <T>(s: string, ...p: BindValue[]) => {
    if (fail && s.startsWith('UPDATE sport_sessions')) throw new Error('Synthetic interrupted removal'); return sql.getFirstAsync<T>(s, ...p);
  } }; const h = harness(port);
  try {
    const { SportForm } = h.load('ui/SportForm.tsx'); const ref = h.React.createRef(); const props = { database: port, entryId: day.entry_id, ref };
    await h.act(async () => { tree = h.create(h.React.createElement(SportForm, props)); });
    await press(h, tree, 'Supprimer cette séance'); await h.act(async () => h.alerts.at(-1).buttons.find((b: any) => b.text === 'Supprimer').onPress());
    const stored = JSON.parse(String(native.prepare("SELECT value FROM settings WHERE key LIKE 'draft.editor.%'").get()!.value));
    assert.deepEqual(Object.keys(stored.fields).sort(), ['distance_km', 'duration_minutes', 'sport_type']);
    await h.act(async () => tree.unmount()); fail = false; await h.act(async () => { tree = h.create(h.React.createElement(SportForm, props)); });
    await press(h, tree, 'Comparer la séance 1 aux valeurs enregistrées');
    for (const name of ['Activité', 'Durée', 'Distance (km)']) await choose(h, tree, `Séance 1 · ${name} · Garder mon brouillon`);
    await press(h, tree, 'Appliquer les choix de cette séance'); await ref.current.flush();
    const latest = await sports.read(first.session_id); assert.equal(latest.sport_type, null); assert.equal(latest.duration_minutes, null); assert.equal(latest.distance_km, null);
    assert.equal((await sports.read(second.session_id)).distance_km, 23);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('restoration keeps private sport buffers but never exports them and never silently replays their valid values', async () => {
  const { native, sql, day, sports } = await fixture();
  try {
    const row = await sports.getOrCreate(day.entry_id, 1); const store = new FieldBuffers(sql, 'sport', row.session_id, kinds, randomUUID); await store.read();
    await store.stage(store.prepare({ distance_km: { raw: { value: '5,2' } } }));
    const snapshot = await captureSnapshot(sql, migrations); assert.equal(snapshot.tables.settings.some(value => String(value.key).startsWith('draft.')), false);
    await restoreSnapshot(sql, JSON.stringify(snapshot), migrations);
    const editor = sportBuffers(sql, row.session_id, randomUUID, () => {}); await editor.read(await sports.read(row.session_id));
    assert.equal(editor.needsComparison(), true); assert.equal((await sports.read(row.session_id)).distance_km, null);
  } finally { native.close(); }
});
