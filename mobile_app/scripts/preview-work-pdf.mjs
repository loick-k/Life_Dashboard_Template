// Synthetic-only QA. No database, environment configuration, secrets or production export is read.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWorkReport } from '../src/domain/workReport.ts';
import { buildWorkPdf } from '../src/domain/workPdf.ts';
import { shiftDate } from '../src/domain/dates.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'artifacts/output/pdf'); mkdirSync(output, { recursive: true });
const fixture = JSON.parse(readFileSync(join(root, 'tests/fixtures/work_pdf.json'), 'utf8'));
const partial = [
  ...Array.from({ length: 14 }, (_, i) => ({ entry_date: shiftDate('2026-08-01', i), work_mode: 'Bureau', work_duration_minutes: 300 })),
  { entry_date: '2026-10-26', work_mode: 'Bureau', work_duration_minutes: 540, work_start_time: '09:00', work_morning_end_time: '12:00', work_afternoon_start_time: '11:00', work_end_time: '17:00' },
  { entry_date: '2026-10-27', work_mode: 'Bureau', work_duration_minutes: null, work_start_time: '08:00', work_end_time: '16:00', work_third_start_time: '18:00' },
  { entry_date: '2026-10-28', work_mode: 'Télétravail', work_duration_minutes: null, work_morning_end_time: '12:30' },
  { entry_date: '2026-10-29', work_mode: 'Day off', work_duration_minutes: 0 },
  { entry_date: '2026-10-30', work_mode: 'Déplacement', work_duration_minutes: 0 },
];
const cases = [
  ['rapport-travail-synthetique.pdf', fixture.records, fixture.date],
  ['rapport-travail-vide.pdf', [], '2026-01-01'],
  ['rapport-travail-partiel.pdf', partial, '2026-10-30'],
];
for (const [name, records, date] of cases) {
  const report = buildWorkReport(records, date, 35), bytes = buildWorkPdf(report);
  writeFileSync(join(output, name), bytes);
  console.log(`${name}: ${bytes.length} bytes; synthetic data only`);
}
