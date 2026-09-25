import type { BindValue, SqlConnection } from './migrations';
import { workDuration, type WorkTimes } from '../domain/work.ts';

type Rule = (value: Exclude<BindValue, null>) => boolean;
const number = (min: number, max: number, integer = false): Rule => value =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));
const text: Rule = value => typeof value === 'string' && value.length <= 10000;
const time: Rule = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const minutes = number(0, 1440, true);

export const dailyRules = {
  alcohol_glasses: number(0, 100, true), sleep_hours: number(0, 24),
  sleep_bedtime: time, sleep_wake_time: time, nap_minutes: number(0, 720, true),
  weight_kg: number(0.1, 1000), body_fat_pct: number(0, 100), belly_cm: number(0.1, 1000),
  work_mode: (value => ['Télétravail', 'Day off', 'Bureau', 'Déplacement'].includes(String(value))) as Rule,
  work_start_time: time, work_morning_end_time: time, work_afternoon_start_time: time,
  work_end_time: time, work_third_start_time: time, work_third_end_time: time,
  phone_minutes: minutes, meal_breakfast: text, meal_lunch: text, meal_dinner: text, meal_other: text,
  me_time_writing_minutes: minutes, me_time_meditation_minutes: minutes,
  me_time_relaxation_minutes: minutes, me_time_outings_minutes: minutes,
  self_listening_score: number(1, 10, true), close_relations_listening_score: number(1, 10, true),
} satisfies Record<string, Rule>;

export type DailyField = keyof typeof dailyRules;
export type DailyPatch = Partial<Record<DailyField, BindValue | undefined>>;
export type DailyEntry = Record<string, BindValue> & {
  entry_id: string; entry_date: string; revision: number;
};

export class RevisionConflict extends Error {
  constructor() { super('Cette journée a changé. Rechargez les valeurs avant de réessayer.'); }
}

export function validateDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Date invalide');
  const parsed = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error('Date invalide');
}

export function validatePatch(patch: DailyPatch): [DailyField, BindValue][] {
  const fields: [DailyField, BindValue][] = [];
  for (const [name, value] of Object.entries(patch)) {
    if (!Object.hasOwn(dailyRules, name)) throw new Error('Champ inconnu');
    if (value === undefined) continue;
    const field = name as DailyField;
    if (value !== null && !dailyRules[field](value)) throw new Error('Valeur invalide');
    fields.push([field, value]);
  }
  return fields;
}

/** Single-statement CAS updates: no stale full-row snapshots and no silent retry. */
export class DailyEntries {
  private database: SqlConnection;
  private uuid: () => string;
  constructor(database: SqlConnection, uuid: () => string) {
    this.database = database;
    this.uuid = uuid;
  }

  async getOrCreate(date: string): Promise<DailyEntry> {
    validateDate(date);
    const now = new Date().toISOString();
    await this.database.runAsync(
      'INSERT INTO daily_entries (entry_id, entry_date, created_at, updated_at, checkin_version) VALUES (?, ?, ?, ?, 5) ON CONFLICT(entry_date) DO NOTHING',
      this.uuid(), date, now, now,
    );
    const row = await this.database.getFirstAsync<DailyEntry>('SELECT * FROM daily_entries WHERE entry_date = ?', date);
    if (!row) throw new Error('Journée indisponible');
    return row;
  }

  async patch(id: string, expectedRevision: number, patch: DailyPatch): Promise<DailyEntry> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error('Révision invalide');
    const fields = validatePatch(patch);
    if (!fields.length) {
      const row = await this.database.getFirstAsync<DailyEntry>('SELECT * FROM daily_entries WHERE entry_id = ? AND revision = ?', id, expectedRevision);
      if (!row) throw new RevisionConflict();
      return row;
    }
    const updates: [string, BindValue][] = [...fields];
    if (fields.some(([field]) => field.startsWith('work_'))) {
      const current = await this.database.getFirstAsync<DailyEntry>('SELECT * FROM daily_entries WHERE entry_id = ? AND revision = ?', id, expectedRevision);
      if (!current) throw new RevisionConflict();
      const merged = { ...current, ...Object.fromEntries(fields) };
      updates.push(['work_duration_minutes', workDuration(merged as WorkTimes)]);
    }
    const row = await this.database.getFirstAsync<DailyEntry>(
      `UPDATE daily_entries SET ${updates.map(([field]) => `${field} = ?`).join(', ')}, revision = revision + 1, updated_at = ? WHERE entry_id = ? AND revision = ? RETURNING *`,
      ...updates.map(([, value]) => value), new Date().toISOString(), id, expectedRevision,
    );
    if (!row) throw new RevisionConflict();
    return row;
  }
}
