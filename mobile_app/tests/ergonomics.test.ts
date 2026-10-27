import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { migrate, type BindValue } from '../src/storage/migrations.ts';
import { DailyEntries } from '../src/storage/dailyEntries.ts';
import { previousMeasure } from '../src/storage/previousMeasures.ts';
import { calendarCells, adjacentMonth } from '../src/domain/calendar.ts';
import { durationFromParts, sumKnownMinutes } from '../src/domain/durationInput.ts';
import { normalizeClock } from '../src/domain/input.ts';
import { parsePreference } from '../src/domain/preferences.ts';
import { CHECKIN_SECTIONS } from '../src/domain/checkinConfig.ts';
import { palette } from '../src/ui/palette.ts';
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

test('precise durations and clock normalization accept French input without interpreting unfinished values as deletion', () => {
  assert.equal(durationFromParts('1', '23'), 83); assert.equal(durationFromParts('', '0'), 0);
  for (const parts of [['',''],['1','60'],['1,','23'],['-1','0']]) assert.equal(durationFromParts(parts[0]!, parts[1]!), undefined);
  assert.equal(sumKnownMinutes([null, undefined]), null); assert.equal(sumKnownMinutes([null, 0]), 0);
  assert.equal(sumKnownMinutes([30, null, 90]), 120);
  for (const text of ['8:48', '0848', '8h48']) assert.equal(normalizeClock(text), '08:48');
  for (const text of ['8:', '08:4', '2448', '2360', '8']) assert.equal(normalizeClock(text), undefined);
  assert.equal(parsePreference('work_standard_start', '8h30'), '08:30');
});

test('calendar starts on Monday, handles leap years/month boundaries and refuses malformed months', () => {
  assert.equal(calendarCells('2026-10')[3], '2026-10-01');
  assert.equal(calendarCells('2024-02').filter(Boolean).length, 29);
  assert.equal(calendarCells('1900-02').filter(Boolean).length, 28);
  assert.equal(adjacentMonth('2026-01', -1), '2025-12');
  assert.equal(adjacentMonth('2026-12', 1), '2027-01');
  assert.throws(() => calendarCells('2026-13')); assert.throws(() => adjacentMonth('0001-01', -1));
});

test('previous measures are dated, independently selected, strictly earlier and preserve zero', async () => {
  const { native, sql } = await fixture();
  try {
    const repo = new DailyEntries(sql, randomUUID);
    for (const [date, values] of [['2026-10-24', { weight_kg: 70, body_fat_pct: 0 }], ['2026-10-25', { weight_kg: 71 }], ['2026-10-26', { weight_kg: 72 }]] as const) {
      const day = await repo.getOrCreate(date); await repo.patch(day.entry_id, day.revision, values);
    }
    assert.deepEqual(await previousMeasure(sql, 'weight_kg', '2026-10-26'), { date: '2026-10-25', value: 71 });
    assert.deepEqual(await previousMeasure(sql, 'body_fat_pct', '2026-10-26'), { date: '2026-10-24', value: 0 });
    assert.equal(await previousMeasure(sql, 'belly_cm', '2026-10-26'), null);
    assert.equal(await previousMeasure(sql, 'weight_kg', '2026-10-24'), null);
    await assert.rejects(previousMeasure(sql, 'unknown' as any, '2026-10-26'));
  } finally { native.close(); }
});

test('inline calendar tolerates malformed manual drafts, disables future days and selects without changing persisted data', async () => {
  const { native, sql } = await fixture(); const h = harness(sql); let tree: any, selected = '';
  try {
    const { FrenchCalendar } = h.load('ui/FrenchCalendar.tsx');
    await h.act(async () => { tree = h.create(h.React.createElement(FrenchCalendar, { value: '2026-13-01', latest: '2026-10-27', disabled: false, onSelect(date: string) { selected = date; } })); });
    const day = tree.root.findAllByType('Pressable').find((node: any) => node.props.accessibilityLabel === 'Choisir le 26/10/2026');
    const future = tree.root.findAllByType('Pressable').find((node: any) => node.props.accessibilityLabel === 'Choisir le 28/10/2026');
    assert.equal(future.props.disabled, true); await h.act(async () => day.props.onPress());
    assert.equal(selected, '2026-10-26'); assert.equal(native.prepare('SELECT count(*) AS n FROM daily_entries').get()!.n, 0);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('phone and me-time use precise hours/minutes, retain unfinished drafts and distinguish absent from zero', async () => {
  const { native, sql } = await fixture(); const h = harness(sql); let tree: any;
  try {
    const { DailyForm } = h.load('ui/DailyForm.tsx');
    await h.act(async () => { tree = h.create(h.React.createElement(DailyForm, { database: sql, initialDate: '2026-10-26' })); });
    await press(h, tree, 'Temps pour moi'); assert.match(label(tree.root), /Temps pour moi total : n.c./);
    await h.act(async () => input(tree, 'Sorties · balades, cafés, bars, restaurants · Heures').props.onChangeText('1'));
    await h.act(async () => input(tree, 'Sorties · balades, cafés, bars, restaurants · Minutes').props.onChangeText('30'));
    assert.match(label(tree.root), /Temps pour moi total : 1h30/);
    await press(h, tree, 'Accueil de la journée'); await press(h, tree, 'Temps de portable');
    await h.act(async () => input(tree, 'Temps de portable · Heures').props.onChangeText('1'));
    await h.act(async () => input(tree, 'Temps de portable · Minutes').props.onChangeText('23'));
    assert.equal(native.prepare('SELECT phone_minutes FROM daily_entries').get()!.phone_minutes, 83);
    await h.act(async () => input(tree, 'Temps de portable · Minutes').props.onChangeText('2,'));
    await press(h, tree, 'Continuer →'); assert.ok(input(tree, 'Temps de portable · Minutes'));
    assert.equal(native.prepare('SELECT phone_minutes FROM daily_entries').get()!.phone_minutes, 83);
    await h.act(async () => input(tree, 'Temps de portable · Minutes').props.onChangeText('23'));
    await press(h, tree, 'Continuer →'); await h.back();
    assert.equal(input(tree, 'Temps de portable · Heures').props.value, '1');
    assert.equal(input(tree, 'Temps de portable · Minutes').props.value, '23');
    assert.equal(native.prepare('SELECT me_time_outings_minutes FROM daily_entries').get()!.me_time_outings_minutes, 90);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('previous measurement reuse requires confirmation, keeps its date visible and changes only the chosen body field', async () => {
  const { native, sql } = await fixture(); const h = harness(sql); let tree: any;
  try {
    const repo = new DailyEntries(sql, randomUUID); const earlier = await repo.getOrCreate('2026-10-25');
    await repo.patch(earlier.entry_id, earlier.revision, { weight_kg: 71 });
    const current = await repo.getOrCreate('2026-10-26');
    await repo.patch(current.entry_id, current.revision, { body_fat_pct: 20, work_start_time: '08:48' });
    const { DailyForm } = h.load('ui/DailyForm.tsx');
    await h.act(async () => { tree = h.create(h.React.createElement(DailyForm, { database: sql, initialDate: current.entry_date })); });
    await press(h, tree, 'Poids'); assert.match(label(tree.root), /71 kg · 25\/10\/2026/);
    assert.equal((await repo.read(current.entry_id)).weight_kg, null);
    await press(h, tree, 'Réutiliser cette mesure'); assert.equal((await repo.read(current.entry_id)).weight_kg, null);
    await h.act(async () => h.alerts.at(-1).buttons.find((item: any) => item.text === 'Réutiliser').onPress());
    const row = await repo.read(current.entry_id);
    assert.equal(row.weight_kg, 71); assert.equal(row.body_fat_pct, 20); assert.equal(row.work_start_time, '08:48');
    assert.equal((await repo.read(earlier.entry_id)).weight_kg, 71);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('daily summary shows the work mode and full cumulative counter with only one energy result', async () => {
  const { native, sql } = await fixture(); const h = harness(sql); let tree: any;
  try {
    const repo = new DailyEntries(sql, randomUUID); let day = await repo.getOrCreate('2026-10-26');
    day = await repo.patch(day.entry_id, day.revision, { work_mode: 'Bureau', work_start_time: '08:00', work_end_time: '16:42' });
    native.prepare('UPDATE daily_entries SET completed_steps = ?, checkin_finished = 1 WHERE entry_id = ?').run(JSON.stringify(CHECKIN_SECTIONS.filter(item => item.id !== 'summary').map(item => item.id)), day.entry_id);
    const { DailyForm } = h.load('ui/DailyForm.tsx');
    await h.act(async () => { tree = h.create(h.React.createElement(DailyForm, { database: sql, initialDate: day.entry_date })); });
    await press(h, tree, 'Voir le récapitulatif');
    assert.match(label(tree.root), /Type de journée : Bureau/); assert.match(label(tree.root), /Compteur après cette journée : \+1h00/);
    assert.equal(tree.root.findAllByType('Text').filter((node: any) => visible(node) && label(node) === 'Bilan énergétique estimé').length, 1);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('first-use protection can open backup before activation and return without losing the wizard position', async () => {
  const { native, sql } = await fixture(); const h = harness(sql); let tree: any;
  try {
    await sql.runAsync('INSERT INTO settings (key,value,updated_at) VALUES (?,?,?)', 'onboarding.v1', JSON.stringify({ version: 1, revision: 1, step: 'protection', completed: false, dataChoice: 'existing' }), new Date().toISOString());
    const { OnboardingScreen } = h.load('ui/OnboardingScreen.tsx');
    await h.act(async () => { tree = h.create(h.React.createElement(OnboardingScreen, { database: sql, onDone() {} })); });
    await press(h, tree, 'Créer une sauvegarde avant activation'); assert.ok(input(tree, 'Code de récupération'));
    await h.back(); assert.match(label(tree.root), /Protection du téléphone/);
    assert.equal(JSON.parse(String(native.prepare('SELECT value FROM settings WHERE key = ?').get('onboarding.v1')!.value)).step, 'protection');
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('corrupt preferences do not prevent opening the dedicated backup route or reset their stored value', async () => {
  const { native, sql } = await fixture(); const h = harness(sql); let tree: any, opened = false;
  try {
    await sql.runAsync('INSERT INTO settings (key,value,updated_at) VALUES (?,?,?)', 'preference.v1:sleep_min_hours', 'synthetic-corrupt', new Date().toISOString());
    const { PreferencesForm } = h.load('ui/PreferencesForm.tsx');
    await h.act(async () => { tree = h.create(h.React.createElement(PreferencesForm, { database: sql, preserveOnNavigate: true, onDone() {}, onBackup() { opened = true; } })); });
    await press(h, tree, 'Sauvegarde et récupération'); assert.equal(opened, true);
    assert.equal(native.prepare('SELECT value FROM settings WHERE key = ?').get('preference.v1:sleep_min_hours')!.value, 'synthetic-corrupt');
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});

test('small white primary action labels have at least 4.5:1 contrast', () => {
  const channels = palette.primary.slice(1).match(/../g)!.map(hex => parseInt(hex, 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const luminance = channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  assert.ok(1.05 / (luminance + 0.05) >= 4.5);
});
