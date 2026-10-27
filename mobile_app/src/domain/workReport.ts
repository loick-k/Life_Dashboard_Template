import { DAILY_WORK_TARGET_MINUTES, workBalance, inspectWorkSchedule, type WorkTimes } from './work.ts';
import { shiftDate } from './dates.ts';
import { validateDate } from '../storage/dailyEntries.ts';

export interface WorkRecord extends WorkTimes { entry_date: string; work_mode: string | null; work_duration_minutes: number | null }
export interface WorkReport {
  date: string; monday: string; sunday: string;
  beforeMinutes: number; cumulativeMinutes: number; afterMinutes: number | null;
  dayMinutes: number | null; dayBalance: number | null;
  countedDays: number; incompleteDays: number;
  invalidSchedules: string[];
  weekMinutes: number | null; weekTargetMinutes: number; weekDifference: number | null;
  rows: (WorkRecord & { balance: number | null; cumulative: number })[];
}

export function formatMinutes(minutes: number | null, signed = false): string {
  if (minutes === null) return 'n.c.';
  if (!Number.isSafeInteger(minutes)) throw new Error('Durée invalide.');
  if (signed && minutes === 0) return 'À l’équilibre';
  const absolute = Math.abs(minutes);
  return `${minutes < 0 ? '−' : signed ? '+' : ''}${Math.floor(absolute / 60)}h${String(absolute % 60).padStart(2, '0')}`;
}

/** One rule for form, Bilan and future PDF. No weekly reset of cumulative balance. */
export function buildWorkReport(records: readonly WorkRecord[], date: string, weeklyTargetHours: number): WorkReport {
  validateDate(date);
  if (!Number.isFinite(weeklyTargetHours) || weeklyTargetHours < 0 || weeklyTargetHours > 80) throw new Error('Objectif hebdomadaire invalide.');
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const monday = shiftDate(date, -((weekday + 6) % 7));
  const report: WorkReport = { date, monday, sunday: shiftDate(monday, 6), beforeMinutes: 0, cumulativeMinutes: 0,
    afterMinutes: null, dayMinutes: null, dayBalance: null, countedDays: 0, incompleteDays: 0, invalidSchedules: [],
    weekMinutes: null, weekTargetMinutes: Math.round(weeklyTargetHours * 60), weekDifference: null, rows: [] };
  const seen = new Set<string>();
  for (const row of [...records].sort((a, b) => a.entry_date.localeCompare(b.entry_date))) {
    validateDate(row.entry_date);
    if (row.entry_date > date) continue;
    if (seen.has(row.entry_date)) throw new Error('Journée dupliquée.');
    seen.add(row.entry_date);
    const overlapping = inspectWorkSchedule(row).issue === 'overlap';
    if (overlapping) report.invalidSchedules.push(row.entry_date);
    const minutes = overlapping ? null : row.work_duration_minutes;
    if (minutes !== null && (!Number.isSafeInteger(minutes) || minutes < 0)) throw new Error('Durée enregistrée invalide.');
    const balance = workBalance(minutes, row.work_mode === 'Day off', DAILY_WORK_TARGET_MINUTES);
    if (balance !== null) { report.cumulativeMinutes += balance; report.countedDays++; }
    else if (row.work_mode && row.work_mode !== 'Day off') report.incompleteDays++;
    if (row.entry_date < date) report.beforeMinutes = report.cumulativeMinutes;
    if (row.entry_date === date) {
      report.dayMinutes = minutes; report.dayBalance = balance;
      report.afterMinutes = balance === null ? null : report.cumulativeMinutes;
    }
    if (row.entry_date >= monday) {
      report.rows.push({ ...row, work_duration_minutes: minutes, balance, cumulative: report.cumulativeMinutes });
      if (minutes !== null) report.weekMinutes = (report.weekMinutes ?? 0) + minutes;
    }
  }
  report.weekDifference = report.weekMinutes === null ? null : report.weekMinutes - report.weekTargetMinutes;
  return report;
}
