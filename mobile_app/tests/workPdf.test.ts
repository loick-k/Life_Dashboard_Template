import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { buildWorkReport } from '../src/domain/workReport.ts';
import { buildWorkPdf } from '../src/domain/workPdf.ts';
import { exportWorkPdf, type PdfExportEnvironment } from '../src/services/workPdfExport.ts';
import { readWorkReport } from '../src/storage/workReport.ts';
import { DailyEntries } from '../src/storage/dailyEntries.ts';
import { migrate, type BindValue } from '../src/storage/migrations.ts';
import type { QueryConnection } from '../src/storage/catalogs.ts';

const { harness, press, button, label } = createRequire(import.meta.url)('./helpers/reactHarness.cjs');
const fixture = JSON.parse(readFileSync('tests/fixtures/work_pdf.json', 'utf8'));
const migrations = JSON.parse(readFileSync('src/storage/generated/migrations.json', 'utf8'));
const report = () => buildWorkReport(fixture.records, fixture.date, 35);

test('PDF uses the shared confirmed model, preserves week opening/third slot and contains two valid bounded pages', () => {
  const model = report(); for (const [key, value] of Object.entries(fixture.expected)) assert.equal(model[key as keyof typeof model], value);
  assert.equal(model.recentRows.length, 9); assert.equal(model.typeCounts.Bureau, 4);
  const bytes = buildWorkPdf(model), pdf = new TextDecoder().decode(bytes);
  assert.equal(bytes.length, pdf.length); assert.ok(bytes.length < 100000);
  assert.ok(pdf.startsWith('%PDF-1.4')); assert.match(pdf, /\/Count 2/);
  assert.equal((pdf.match(/\/Type \/Page /g) ?? []).length, 2);
  const decoded = [...pdf.matchAll(/<([\da-f]+)> Tj/g)].map(match => Buffer.from(match[1]!, 'hex').toString('latin1')).join('\n');
  for (const value of ['+1h48', '24h36', '18:00 - 18:30', '08:55 - n.c.', 'T\u00e9l\u00e9travail', 'Cr\u00e9neau 3', 'Cumul total']) assert.ok(decoded.includes(value), value);
  assert.ok(!decoded.includes('999')); // Future synthetic day never enters the PDF.
  const xrefAt = Number(/startxref\n(\d+)/.exec(pdf)![1]); assert.ok(pdf.slice(xrefAt).startsWith('xref\n'));
  const lines = pdf.slice(xrefAt).split('\n');
  for (let index = 1; index <= 9; index++) assert.ok(pdf.slice(Number(lines[index + 2]!.slice(0, 10))).startsWith(`${index} 0 obj`));
  for (const stream of pdf.matchAll(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)endstream/g)) assert.equal(stream[2]!.length, Number(stream[1]));
  assert.ok(!/\/OpenAction|\/JavaScript|\/EmbeddedFile/.test(pdf));
});

test('empty, partial, negative and old overlapping schedules remain explicit without inventing hours', () => {
  const empty = buildWorkReport([], '2026-01-01', 35); assert.equal(empty.weekMinutes, null);
  assert.ok(buildWorkPdf(empty).length > 5000);
  const partial = buildWorkReport([
    { entry_date: '2026-10-20', work_mode: 'Bureau', work_duration_minutes: 0 },
    { entry_date: '2026-10-26', work_mode: null, work_duration_minutes: null, work_start_time: '08:48' },
    { entry_date: '2026-10-27', work_mode: 'Bureau', work_duration_minutes: 540, work_start_time: '09:00', work_morning_end_time: '12:00', work_afternoon_start_time: '11:00', work_end_time: '17:00' },
  ], '2026-10-27', 35);
  assert.equal(partial.cumulativeMinutes, -462); assert.equal(partial.weekOpeningMinutes, -462);
  assert.equal(partial.incompleteDays, 2); assert.equal(partial.typeCounts['Non renseigné'], 1);
  assert.equal(partial.recentRows.length, 1); assert.equal(partial.invalidSchedules.length, 1);
  assert.ok(buildWorkPdf(partial).length > 5000);
  const many = Array.from({ length: 30 }, (_, index) => ({ entry_date: `2026-09-${String(index + 1).padStart(2, '0')}`, work_mode: 'Bureau', work_duration_minutes: 462 }));
  assert.equal(buildWorkReport(many, '2026-10-01', 35).recentRows.length, 14);
  assert.throws(() => buildWorkPdf({ ...empty, typeCounts: { 'Unknown \u{1f4bb}': 1 } }));
  assert.throws(() => buildWorkPdf({ ...partial, rows: [{ ...partial.rows[0]!, work_start_time: 'malformed' }] }));
});

test('export cancels cleanly, checks byte-for-byte readback, never reports a corrupt or failed file as verified', async () => {
  let written = new Uint8Array(), name = '', writes = 0;
  const environment: PdfExportEnvironment = { uuid: randomUUID, chooseDestination: async filename => { name = filename; return {
    write: async bytes => { writes++; written = Uint8Array.from(bytes); }, read: async () => Uint8Array.from(written),
  }; } };
  assert.equal(await exportWorkPdf(report(), { ...environment, chooseDestination: async () => null }), 'cancelled');
  assert.equal(writes, 0); assert.equal(await exportWorkPdf(report(), environment), 'verified');
  assert.match(name, /^travail-2026-10-30-[a-f\d-]{36}\.pdf$/);
  await assert.rejects(exportWorkPdf(report(), { ...environment, chooseDestination: async () => ({
    write: async bytes => { written = Uint8Array.from(bytes); }, read: async () => written.slice(0, -1),
  }) }));
  await assert.rejects(exportWorkPdf(report(), { ...environment, chooseDestination: async () => ({
    write: async () => { throw new Error('Synthetic write failure'); }, read: async () => written,
  }) }));
  await assert.rejects(exportWorkPdf(report(), { ...environment, uuid: () => '../not-a-name' }));
});

test('work repository and PDF exclude unrelated personal fields and export makes no database writes', async () => {
  const native = new DatabaseSync(':memory:');
  const sql: QueryConnection = {
    execAsync: async statement => { native.exec(statement); },
    getFirstAsync: async <T>(statement: string, ...params: BindValue[]) => native.prepare(statement).get(...params) as T ?? null,
    getAllAsync: async <T>(statement: string, ...params: BindValue[]) => native.prepare(statement).all(...params) as T[],
    runAsync: async (statement, ...params) => ({ changes: Number(native.prepare(statement).run(...params).changes) }),
  };
  try {
    await migrate(sql, migrations); const repo = new DailyEntries(sql, randomUUID); const day = await repo.getOrCreate('2026-10-26');
    await repo.patch(day.entry_id, day.revision, { weight_kg: 73, meal_lunch: 'Unrelated synthetic personal meal', work_mode: 'Bureau', work_start_time: '08:00', work_end_time: '16:42' });
    const before = native.prepare('SELECT total_changes() AS n').get()!.n, model = await readWorkReport(sql, '2026-10-27');
    assert.ok(!JSON.stringify(model).includes('Unrelated synthetic personal meal'));
    assert.ok(!Object.hasOwn(model.rows[0]!, 'weight_kg'));
    let data = new Uint8Array(); await exportWorkPdf(model, { uuid: randomUUID, chooseDestination: async () => ({ write: async bytes => { data = Uint8Array.from(bytes); }, read: async () => data }) });
    assert.equal(native.prepare('SELECT total_changes() AS n').get()!.n, before);
  } finally { native.close(); }
});

test('real export control asks unencrypted consent, serializes taps and verifies native-file port before success', async () => {
  let data = new Uint8Array(), picks = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const busy: boolean[] = [];
  const h = harness({}, { pickDirectory: async () => { picks++; return { createFile: (_: string, mime: string) => {
    assert.equal(mime, 'application/pdf'); return { write(bytes: Uint8Array) { data = Uint8Array.from(bytes); }, bytes: async () => { await gate; return data; } };
  } }; } }); let tree: any;
  try {
    const { WorkPdfExport } = h.load('ui/WorkPdfExport.tsx');
    await h.act(async () => { tree = h.create(h.React.createElement(WorkPdfExport, { report: report(), onBusy(value: boolean) { busy.push(value); } })); });
    await press(h, tree, 'Enregistrer le rapport PDF du travail'); assert.equal(picks, 0);
    assert.match(h.alerts.at(-1).message, /dossier choisi peut toutefois être synchronisé/);
    await h.act(async () => h.alerts.at(-1).buttons.find((choice: any) => choice.text === 'Annuler').onPress());
    assert.equal(picks, 0); assert.match(label(tree.root), /Export annulé/);
    await press(h, tree, 'Enregistrer le rapport PDF du travail');
    await h.act(async () => h.alerts.at(-1).buttons.find((choice: any) => choice.text === 'Exporter').onPress());
    assert.equal(picks, 1); assert.equal(button(tree, 'Export en cours…').props.disabled, true);
    assert.ok(!label(tree.root).includes('relu à l’identique'));
    await h.act(async () => release()); assert.match(label(tree.root), /PDF enregistré et relu à l’identique/);
    assert.deepEqual(busy, [true, false, true, false]);
  } finally { release(); if (tree) await h.act(async () => tree.unmount()); }
});

test('Bilan places export below the duration graph and blocks Back/date changes until the picker is finished', async () => {
  // A minimal SQL port serves the actual work report, not a mocked Bilan component.
  const sql = { getFirstAsync: async () => null, getAllAsync: async (statement: string) => statement.includes('SELECT entry_date, work_mode') ? fixture.records : [] };
  let left = 0, tree: any; const h = harness(sql);
  try {
    const { WorkBilan } = h.load('ui/WorkBilan.tsx');
    await h.act(async () => { tree = h.create(h.React.createElement(WorkBilan, { database: sql, initialDate: fixture.date, onDone() { left++; } })); });
    await press(h, tree, 'Enregistrer le rapport PDF du travail');
    assert.equal(button(tree, '← Semaine précédente').props.disabled, true);
    await h.back(); assert.equal(left, 0);
    await h.act(async () => h.alerts.at(-1).buttons.find((choice: any) => choice.text === 'Annuler').onPress());
    assert.equal(button(tree, '← Semaine précédente').props.disabled, false);
    await h.back(); assert.equal(left, 1);
  } finally { if (tree) await h.act(async () => tree.unmount()); }
});

test('real export reports a same-length altered file as unconfirmed and supports an explicit retry', async () => {
  let stored = new Uint8Array(), corrupt = true; const names: string[] = [];
  const h = harness({}, { pickDirectory: async () => ({ createFile(name: string) {
    names.push(name); return { write(bytes: Uint8Array) { stored = Uint8Array.from(bytes); }, bytes: async () => {
      const result = Uint8Array.from(stored); if (corrupt) result[0] = result[0]! ^ 1; return result;
    } };
  } }) }); let tree: any;
  try {
    const { WorkPdfExport } = h.load('ui/WorkPdfExport.tsx');
    await h.act(async () => { tree = h.create(h.React.createElement(WorkPdfExport, { report: report() })); });
    await press(h, tree, 'Enregistrer le rapport PDF du travail');
    await h.act(async () => h.alerts.at(-1).buttons.find((choice: any) => choice.text === 'Exporter').onPress());
    assert.match(label(tree.root), /Export non confirmé/); assert.ok(!label(tree.root).includes('relu à l’identique'));
    corrupt = false; await press(h, tree, 'Enregistrer le rapport PDF du travail');
    await h.act(async () => h.alerts.at(-1).buttons.find((choice: any) => choice.text === 'Exporter').onPress());
    assert.match(label(tree.root), /relu à l’identique/); assert.equal(names.length, 2); assert.notEqual(names[0], names[1]);
  } finally { if (tree) await h.act(async () => tree.unmount()); }
});

test('main menu and its Back handler respect export lock even when an older tab callback is invoked', async () => {
  const native = new DatabaseSync(':memory:');
  const sql: QueryConnection = {
    execAsync: async statement => { native.exec(statement); },
    getFirstAsync: async <T>(statement: string, ...params: BindValue[]) => native.prepare(statement).get(...params) as T ?? null,
    getAllAsync: async <T>(statement: string, ...params: BindValue[]) => native.prepare(statement).all(...params) as T[],
    runAsync: async (statement, ...params) => ({ changes: Number(native.prepare(statement).run(...params).changes) }),
  }; const h = harness(sql); let tree: any;
  try {
    await migrate(sql, migrations);
    await sql.runAsync('INSERT INTO settings VALUES (?,?,?)', 'onboarding.v1', JSON.stringify({ version: 1, revision: 1, step: 'review', completed: true, dataChoice: 'existing' }), new Date().toISOString());
    const App = h.load('App.tsx').default;
    await h.act(async () => { tree = h.create(h.React.createElement(App)); });
    await press(h, tree, 'Bilan', 'tab'); const oldTabAction = button(tree, 'Saisie', 'tab').props.onPress;
    await press(h, tree, 'Enregistrer le rapport PDF du travail');
    assert.equal(button(tree, 'Saisie', 'tab').props.disabled, true);
    await h.act(async () => oldTabAction()); await h.back();
    assert.equal(button(tree, 'Bilan', 'tab').props.accessibilityState.selected, true);
    await h.act(async () => h.alerts.at(-1).buttons.find((choice: any) => choice.text === 'Annuler').onPress());
    assert.equal(button(tree, 'Saisie', 'tab').props.disabled, false); await press(h, tree, 'Saisie', 'tab');
    assert.equal(button(tree, 'Saisie', 'tab').props.accessibilityState.selected, true);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});
