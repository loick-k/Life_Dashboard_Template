import { formatMinutes, type WorkRecord, type WorkReport } from './workReport.ts';
import { validateDate } from '../storage/dailyEntries.ts';
import { shiftDate } from './dates.ts';

// Minimal vector PDF 1.4. No runtime dependency, web view, network, JS action or personal temp file.
// All commands and standard-font resources are fixed; variable text is encoded as hex, never PDF syntax.
const width = 842, height = 595, margin = 42, usable = width - margin * 2;
const navy = '0.153 0.196 0.282', blue = '0.145 0.388 0.922', gray = '0.39 0.41 0.45';
const knownModes = new Set(['Bureau', 'Télétravail', 'Day off', 'Déplacement', 'Non renseigné']);
const dateText = (value: string) => value.split('-').reverse().join('/');
const duration = (minutes: number | null, signed = false) => formatMinutes(minutes, signed).replaceAll('−', '-').replaceAll('’', "'");
function hexText(value: string): string {
  const text = value.replace(/[−–—‑]/g, '-').replace(/[’‘]/g, "'").replace(/\u00a0/g, ' ');
  return '<' + Array.from(text, character => {
    const code = character.codePointAt(0)!;
    if (code < 32 || code > 255 || code >= 127 && code < 160) throw new Error('Texte PDF non pris en charge');
    return code.toString(16).padStart(2, '0');
  }).join('') + '>';
}
function decimal(value: number): string {
  if (!Number.isFinite(value)) throw new Error('Coordonnée PDF invalide');
  return Number(value.toFixed(3)).toString();
}
class Page {
  commands: string[] = [];
  text(text: string, x: number, y: number, size = 10, bold = false, color = navy) {
    this.commands.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${color} rg 1 0 0 1 ${decimal(x)} ${decimal(y)} Tm ${hexText(text)} Tj ET`);
  }
  box(x: number, y: number, w: number, h: number, color: string) { this.commands.push(`${color} rg ${decimal(x)} ${decimal(y)} ${decimal(w)} ${decimal(h)} re f`); }
  line(x: number, y: number, x2: number, y2: number, color = '0.82 0.84 0.87', weight = 0.5) {
    this.commands.push(`${color} RG ${weight} w ${decimal(x)} ${decimal(y)} m ${decimal(x2)} ${decimal(y2)} l S`);
  }
  paragraph(text: string, x: number, y: number, maxWidth = usable, size = 9, color = gray): number {
    const maxCharacters = Math.floor(maxWidth / (size * 0.62));
    let line = '';
    for (const word of text.split(' ')) {
      if (line && line.length + word.length + 1 > maxCharacters) { this.text(line, x, y, size, false, color); y -= size + 4; line = ''; }
      line += (line ? ' ' : '') + word;
    }
    if (line) { this.text(line, x, y, size, false, color); y -= size + 4; }
    return y;
  }
  footer(number: number) {
    this.line(margin, 39, width - margin, 39);
    this.text('Life Dashboard - Données personnelles / PDF non chiffré', margin, 23, 8, false, gray);
    this.text(`${number} / 2`, width - margin - 26, 23, 8, false, gray);
  }
}
function clockPair(a?: string | null, b?: string | null) { return a || b ? `${a ?? 'n.c.'} - ${b ?? 'n.c.'}` : '-'; }
function slots(row: WorkRecord | undefined): string[] {
  if (!row) return ['-', '-', '-'];
  const continuous = !!row.work_start_time && !!row.work_end_time && !row.work_morning_end_time && !row.work_afternoon_start_time;
  return [continuous ? clockPair(row.work_start_time, row.work_end_time) : clockPair(row.work_start_time, row.work_morning_end_time),
    continuous ? 'En continu' : clockPair(row.work_afternoon_start_time, row.work_end_time), clockPair(row.work_third_start_time, row.work_third_end_time)];
}

export function buildWorkPdf(report: WorkReport): Uint8Array {
  validateDate(report.date); validateDate(report.monday); validateDate(report.sunday);
  if (report.rows.length > 7 || report.recentRows.length > 14) throw new Error('Rapport hors limites');
  for (const count of Object.values(report.typeCounts)) if (!Number.isSafeInteger(count) || count < 0) throw new Error('Compteur de types invalide');
  for (const row of [...report.rows, ...report.recentRows]) {
    const clocks = [row.work_start_time, row.work_morning_end_time, row.work_afternoon_start_time, row.work_end_time, row.work_third_start_time, row.work_third_end_time];
    if (clocks.some(clock => clock !== null && clock !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(clock))) throw new Error('Horaire PDF incompatible');
    if (row.work_duration_minutes !== null && (!Number.isSafeInteger(row.work_duration_minutes) || row.work_duration_minutes < 0 || row.work_duration_minutes > 4320)) throw new Error('Durée PDF incompatible');
  }
  for (const mode of [...Object.keys(report.typeCounts), ...report.rows.map(row => row.work_mode || 'Non renseigné')])
    if (!knownModes.has(mode)) throw new Error('Type de journée PDF incompatible');
  const first = new Page(), chart = new Page();
  for (const page of [first, chart]) page.text('LIFE DASHBOARD / BILAN', margin, 553, 10, true, gray);
  first.text('Rapport du temps de travail', margin, 521, 22, true);
  first.text(`Situation au ${dateText(report.date)} (Paris) - semaine du ${dateText(report.monday)} au ${dateText(report.sunday)}`, margin, 501, 10, false, gray);
  const metricWidth = (usable - 28) / 3;
  [['Compteur cumulé', duration(report.cumulativeMinutes, true)], ['Durée cette semaine', duration(report.weekMinutes)], ['Référence quotidienne', '7h42']].forEach(([title, value], index) => {
    const x = margin + index * (metricWidth + 14);
    first.box(x, 416, metricWidth, 58, '0.918 0.949 1'); first.text(title!, x + 14, 453, 10, true);
    first.text(value!, x + 14, 429, value!.length > 15 ? 17 : 24, true, blue);
  });
  first.text(`${report.countedDays} journée(s) comptée(s) - ${report.incompleteDays} non calculable(s), dont ${report.invalidSchedules.length} avec chevauchement.`, margin, 397, 9, false, gray);
  first.text('Types de journée - historique connu jusqu\'à la date', margin, 374, 12, true);
  const types = Object.entries(report.typeCounts).map(([name, count]) => `${name} : ${count}`).join('   /   ');
  first.paragraph(types || 'Aucune journée de travail renseignée.', margin, 355, usable, 10);
  first.text('Détail de la semaine', margin, 326, 12, true);
  const widths = [75, 100, 105, 105, 90, 75, 85, 123], headers = ['Date', 'Type de journée', 'Créneau 1', 'Créneau 2', 'Créneau 3', 'Durée', 'Écart jour', 'Cumul total'];
  const xPositions = widths.map((_, index) => margin + widths.slice(0, index).reduce((a, b) => a + b, 0));
  first.box(margin, 290, usable, 25, navy);
  headers.forEach((title, index) => first.text(title, xPositions[index]! + 8, 299, 9, true, '1 1 1'));
  let cumulative = report.weekOpeningMinutes;
  for (let index = 0; index < 7; index++) {
    const date = shiftDate(report.monday, index), row = report.rows.find(row => row.entry_date === date), future = date > report.date;
    if (row) cumulative = row.cumulative;
    const bottom = 262 - index * 28;
    if (index % 2 === 0) first.box(margin, bottom, usable, 28, '0.965 0.969 0.976');
    first.line(margin, bottom, width - margin, bottom);
    const cells = [dateText(date), future ? 'À venir' : row?.work_mode || 'Non renseigné', ...slots(row),
      future ? '-' : duration(row?.work_duration_minutes ?? null), future ? '-' : duration(row?.balance ?? null, true), future ? '-' : duration(cumulative, true)];
    cells.forEach((cell, column) => first.text(cell, xPositions[column]! + 8, bottom + 10, 9, false, future ? gray : navy));
  }
  first.text(`Objectif semaine : ${duration(report.weekTargetMinutes)} - écart : ${duration(report.weekDifference, true)} - compteur avant lundi : ${duration(report.weekOpeningMinutes, true)}`, margin, 73, 9);
  first.text('n.c. : non calculable / non renseigné. Les horaires partiels sont conservés ; aucune durée n\'est inventée.', margin, 58, 8, false, gray);
  first.footer(1);

  chart.text('Durée de travail', margin, 521, 22, true);
  chart.text('14 dernières journées à durée renseignée - historique connu jusqu\'au ' + dateText(report.date), margin, 501, 10, false, gray);
  const recent = report.recentRows;
  if (!recent.length) chart.text('Aucune durée calculable sur la période.', margin + 80, 348, 15, false, gray);
  else {
    const left = 77, baseline = 246, plotWidth = width - margin - left, plotHeight = 210;
    const maximum = Math.max(480, ...recent.map(row => row.work_duration_minutes ?? 0));
    const step = Math.ceil(maximum / 6 / 60) * 60, ceiling = Math.ceil(maximum / step) * step;
    for (let tick = 0; tick <= ceiling; tick += step) {
      const y = baseline + tick / ceiling * plotHeight;
      chart.line(left, y, width - margin, y, '0.86 0.88 0.91'); chart.text(`${tick / 60}h`, margin, y - 3, 8, false, gray);
    }
    const slot = plotWidth / Math.max(recent.length, 7), barWidth = Math.min(36, slot * 0.62);
    recent.forEach((row, index) => {
      const x = left + slot * (index + 0.5), minutes = row.work_duration_minutes!, barHeight = minutes / ceiling * plotHeight;
      chart.box(x - barWidth / 2, baseline, barWidth, Math.max(1.5, barHeight), blue);
      chart.text(duration(minutes), x - 13, baseline + barHeight + 6, 8, true);
      chart.text(row.entry_date.slice(5).split('-').reverse().join('/'), x - 12, 229, 8);
      chart.text(row.entry_date.slice(0, 4), x - 10, 216, 8, false, gray);
    });
  }
  let y = 184;
  for (const note of [
    'Compteur : tout l\'historique connu, pas seulement la semaine. Référence : 7h42 par journée travaillée ; cible Day off : 0h.',
    'Jours sans durée calculable, journées futures et chevauchements ne sont pas déduits du compteur. Les types de journée ne comptent pas les journées sans aucune saisie de travail.',
    'Les valeurs présentées sont enregistrées localement. Les brouillons non confirmés ne figurent pas dans ce rapport.',
    `${report.invalidSchedules.length} journée(s) aux horaires chevauchants exclue(s). Consulte le Bilan pour leurs dates et ouvre ces journées pour corriger les horaires.`,
    'La semaine peut être partielle : sa durée renseignée est comparée à l\'objectif hebdomadaire complet, sans proratisation.',
    'Ce PDF est non chiffré : conserve-le dans un espace privé. Il ne remplace pas une sauvegarde chiffrée de l\'application.',
  ]) { y = chart.paragraph(note, margin, y, usable, 8); y -= 2; }
  chart.footer(2);
  const page = (contents: number) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contents} 0 R >>`;
  const stream = (commands: string[]) => { const contents = commands.join('\n') + '\n'; return `<< /Length ${contents.length} >>\nstream\n${contents}endstream`; };
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [6 0 R 8 0 R] /Count 2 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Title ${hexText('Rapport du temps de travail')} /Author ${hexText('Life Dashboard')} /Producer ${hexText('Life Dashboard V2 - local')} >>`,
    page(7), stream(first.commands), page(9), stream(chart.commands),
  ];
  let document = '%PDF-1.4\n%LifeDashboard\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(document.length); document += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = document.length;
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Text is hex-encoded: every serialized character is ASCII, so offsets equal byte offsets.
  return new TextEncoder().encode(document);
}
