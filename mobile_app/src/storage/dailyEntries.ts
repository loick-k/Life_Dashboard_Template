import type { BindValue, SqlConnection } from './migrations';
import { workDuration, type WorkTimes } from '../domain/work.ts';
import { sleepDurationHours } from '../domain/sleep.ts';
import { nutritionInputFields } from '../domain/nutrition.ts';

type Rule = (value: Exclude<BindValue, null>) => boolean;
const number = (min: number, max: number, integer = false): Rule => value =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));
const text: Rule = value => typeof value === 'string' && value.length <= 10000;
const time: Rule = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const minutes = number(0, 1440, true);

export const dailyRules = {
  alcohol_glasses: number(0, 100, true), sleep_hours: number(0, 24),
  sleep_bedtime: time, sleep_wake_time: time, nap_minutes: number(0, 720, true),
  sleep_duration_mode: (value => ['calculated', 'manual', 'imported'].includes(String(value))) as Rule,
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

  async read(id: string): Promise<DailyEntry> {
    const row = await this.database.getFirstAsync<DailyEntry>('SELECT * FROM daily_entries WHERE entry_id = ?', id);
    if (!row) throw new Error('Journée absente. Aucun brouillon remplacé.');
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
    const current = await this.database.getFirstAsync<DailyEntry>('SELECT * FROM daily_entries WHERE entry_id = ? AND revision = ?', id, expectedRevision);
    if (!current) throw new RevisionConflict();
    const changed = Object.fromEntries(fields);
    const merged = { ...current, ...changed };
    const put = (name: string, value: BindValue) => { const existing = updates.findIndex(([key]) => key === name); if (existing >= 0) updates[existing] = [name, value]; else updates.push([name, value]); };
    // A change of day type is not a request to replace a historical duration.
    // In particular, V1 imports can have a valid stored duration and partial/no clocks.
    const workClocks = ['work_start_time', 'work_morning_end_time', 'work_afternoon_start_time', 'work_end_time', 'work_third_start_time', 'work_third_end_time'];
    if (fields.some(([field, value]) => workClocks.includes(field) && value !== current[field])) {
      updates.push(['work_duration_minutes', workDuration(merged as WorkTimes)]);
    }
    if (fields.some(([field]) => ['sleep_bedtime', 'sleep_wake_time', 'sleep_hours', 'sleep_duration_mode'].includes(field))) {
      const clocksChanged = fields.some(([field, value]) => ['sleep_bedtime', 'sleep_wake_time'].includes(field) && value !== current[field]);
      let mode = String(changed.sleep_duration_mode ?? current.sleep_duration_mode ?? 'calculated');
      if (Object.hasOwn(changed, 'sleep_hours') && !Object.hasOwn(changed, 'sleep_duration_mode')) mode = 'manual';
      if (mode === 'imported' && clocksChanged) mode = 'calculated';
      if (mode === 'calculated') {
        const duration = sleepDurationHours(merged.sleep_bedtime, merged.sleep_wake_time);
        if (changed.sleep_duration_mode === 'calculated' && duration === null) throw new Error('Renseigne les deux horaires avant de choisir la durée calculée.');
        if (Object.hasOwn(changed, 'sleep_hours') && changed.sleep_hours !== duration) throw new Error('Durée différente des horaires : choisir le mode manuel explicitement.');
        put('sleep_hours', duration);
      }
      put('sleep_duration_mode', mode);
    }
    if (fields.some(([field, value]) => (nutritionInputFields as readonly string[]).includes(field) && value !== current[field])) {
      put('nutrition_estimate_stale', 1);
      put('nutrition_inputs_revision', 1); // SQL increments the current derived revision atomically.
    }
    const row = await this.database.getFirstAsync<DailyEntry>(
      `UPDATE daily_entries SET ${updates.map(([field]) => field === 'nutrition_inputs_revision' ? 'nutrition_inputs_revision = nutrition_inputs_revision + 1' : `${field} = ?`).join(', ')}, revision = revision + 1, updated_at = ? WHERE entry_id = ? AND revision = ? RETURNING *`,
      ...updates.filter(([field]) => field !== 'nutrition_inputs_revision').map(([, value]) => value), new Date().toISOString(), id, expectedRevision,
    );
    if (!row) throw new RevisionConflict();
    return row;
  }
}
