import { dailyRules, validateDate, validatePatch, type DailyField } from './dailyEntries.ts';
import type { BindValue } from './migrations';
import { FRIEND_CATEGORIES } from './catalogs.ts';
import { SPORT_TYPES } from './sportSessions.ts';
import { preferenceDefinitions, parsePreference, type PreferenceKey } from '../domain/preferences.ts';
import { workDuration, type WorkTimes } from '../domain/work.ts';
import { indicatorIds } from './checkinProgress.ts';
import { convertV1Progress } from './v1Progress.ts';
import { canonical, parseV1Bundle, v1Tables, v1Uuid, type V1Crypto, type V1Row, type V1Table } from './v1Format.ts';

export type ImportTarget = 'friends' | 'goals' | 'daily_entries' | 'sport_sessions' | 'social_logs' | 'goal_logs' | 'settings';
export interface ImportRecord { table: ImportTarget; unit: string; values: Record<string, BindValue> }
export interface ImportArchive { table: string; key: string; payload: string }
export interface V1Plan {
  sourceId: string; fingerprint: string; records: ImportRecord[]; archive: ImportArchive[];
  sourceCounts: Record<V1Table, number>; warnings: Record<string, number>; excludedSettings: number;
}
const sourceId = (value: unknown): string => {
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'number' && !Number.isSafeInteger(value)) || !/^[1-9]\d*$/.test(String(value))) throw new Error('Identifiant V1 invalide.');
  return String(value);
};
const numeric = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Nombre V1 invalide.');
  return value;
};
function date(value: unknown): string { if (typeof value !== 'string') throw new Error('Date V1 invalide.'); validateDate(value); return value; }
function text(value: unknown, fallback: string | null = null): string | null {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > 10000) throw new Error('Texte V1 invalide.');
  return value;
}
function flag(value: unknown, fallback = 1): number {
  if (value === null || value === undefined) return fallback;
  if (![0, 1, false, true].includes(value as number)) throw new Error('État V1 invalide.');
  return value ? 1 : 0;
}
function identity(table: V1Table, row: V1Row): string {
  if (table === 'daily_entries' || table === 'checkin_progress') return date(row.entry_date);
  if (table === 'sport_sessions') {
    if (!Number.isInteger(row.session_index) || Number(row.session_index) < 1 || Number(row.session_index) > 3) throw new Error('Position sportive V1 invalide.');
    return canonical([date(row.entry_date), row.session_index]);
  }
  if (table === 'goal_logs') return canonical([date(row.entry_date), sourceId(row.goal_id)]);
  if (table === 'settings') return String(row.key);
  if (table === 'schema_migrations') {
    const id = row.migration_id ?? row.id;
    if (typeof id !== 'string' || !id) throw new Error('Journal V1 invalide.');
    return id;
  }
  return sourceId(row.id);
}

export async function convertV1(raw: string, crypto: V1Crypto): Promise<V1Plan> {
  const source = await parseV1Bundle(raw, crypto);
  const plan: V1Plan = { sourceId: source.sourceId, fingerprint: source.fingerprint, records: [], archive: [],
    sourceCounts: {} as Record<V1Table, number>, warnings: {}, excludedSettings: source.excludedSettings };
  const warn = (key: string) => { plan.warnings[key] = (plan.warnings[key] ?? 0) + 1; };
  const stamp = (value: unknown) => {
    if (typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
    if (value !== null && value !== undefined) warn('timestamp_export_fallback');
    return source.createdAt;
  };
  const minutes = (hours: unknown): number | null => {
    const value = numeric(hours);
    if (value === null) return null;
    if (value < 0 || value > 72) throw new Error('Durée V1 hors limites.');
    if (Math.abs(value * 60 - Math.round(value * 60)) > 0.000001) warn('rounded_minutes');
    return Math.round(value * 60);
  };
  const uuid = (table: string, key: string) => v1Uuid(crypto, source.sourceId, table, key);
  const add = (table: ImportTarget, unit: string, values: Record<string, BindValue>) => plan.records.push({ table, unit, values });
  const byDay = new Map<string, Partial<Record<V1Table, V1Row[]>>>();
  for (const table of v1Tables) {
    const rows = source.tables[table]; plan.sourceCounts[table] = rows.length;
    const seen = new Set<string>();
    for (const row of rows) {
      const key = identity(table, row);
      if (seen.has(key)) throw new Error(`Clé source dupliquée : ${table}.`);
      seen.add(key); plan.archive.push({ table, key, payload: canonical(row) });
      if (['daily_entries', 'sport_sessions', 'social_logs', 'goal_logs', 'checkin_progress'].includes(table)) {
        const day = date(row.entry_date), group = byDay.get(day) ?? {};
        (group[table] ??= []).push(row); byDay.set(day, group);
      }
    }
  }
  for (const table of ['friends', 'goals'] as const) for (const row of source.tables[table]) {
    const id = sourceId(row.id), label = text(table === 'friends' ? row.name : row.title);
    if (!label?.trim() || label.length > 200) throw new Error('Libellé de catalogue V1 invalide.');
    if (row.active === null || row.active === undefined) warn('legacy_default_flags');
    const common = { active: flag(row.active), revision: 1, created_at: stamp(row.created_at), updated_at: stamp(row.updated_at ?? row.created_at) };
    if (table === 'friends') {
      const category = text(row.category, 'Ami')!;
      if (!FRIEND_CATEGORIES.includes(category)) throw new Error('Catégorie sociale V1 inconnue.');
      add(table, `${table}:${id}`, { ...common, friend_id: await uuid(table, id), name: label, category });
    } else add(table, `${table}:${id}`, { ...common, goal_id: await uuid(table, id), title: label,
      completed_at: row.completed_at ? stamp(row.completed_at) : null });
  }
  for (const row of source.tables.settings) {
    const key = row.key as PreferenceKey, definition = preferenceDefinitions.find(item => item.key === key)!;
    const value = row.value === null || row.value === '' ? ('optional' in definition ? null : definition.initial) : parsePreference(key, String(row.value));
    add('settings', `settings:${key}`, { key: `preference.v1:${key}`, value: JSON.stringify({ version: 1, revision: 1, value }), updated_at: source.createdAt });
  }
  for (const [day, group] of [...byDay].sort(([a],[b]) => a.localeCompare(b))) {
    const unit = `__day:${day}`;
    const stableGroup = Object.fromEntries(Object.entries(group).map(([table, rows]) => [table, rows!.map(row => canonical(row)).sort()]));
    plan.archive.push({ table: '__day', key: day, payload: canonical(stableGroup) });
    const rawDay = group.daily_entries?.[0] ?? {}, id = await uuid('daily_entries', day);
    const row: Record<string, BindValue> = { entry_id: id, entry_date: day, revision: 1, created_at: stamp(rawDay.updated_at), updated_at: stamp(rawDay.updated_at) };
    for (const field of Object.keys(dailyRules) as DailyField[]) if (Object.hasOwn(rawDay, field)) {
      const value = rawDay[field];
      if (typeof value === 'boolean') throw new Error('Valeur quotidienne V1 invalide.');
      row[field] = value!;
    }
    row.work_mode = text(rawDay.work_travel);
    if ((row.belly_cm === null || row.belly_cm === undefined) && rawDay.waist_cm !== null && rawDay.waist_cm !== undefined) row.belly_cm = numeric(rawDay.waist_cm);
    if (rawDay.waist_cm !== null && rawDay.waist_cm !== undefined && rawDay.belly_cm !== null && rawDay.belly_cm !== undefined && rawDay.waist_cm !== rawDay.belly_cm) warn('legacy_waist_archived');
    row.phone_minutes = minutes(rawDay.phone_hours);
    const calculated = workDuration(row as WorkTimes), stored = minutes(rawDay.work_duration_hours ?? rawDay.work_hours);
    row.work_duration_minutes = stored ?? calculated;
    if (stored !== null && calculated !== null && Math.abs(stored - calculated) > 1) warn('work_duration_disagreement_archived');
    for (const field of ['kcal', 'sport_kcal_burned', 'proteins_g', 'carbs_g', 'fats_g']) {
      row[field] = numeric(rawDay[field]);
      if (row[field] !== null && (Number(row[field]) < 0 || (['kcal', 'sport_kcal_burned'].includes(field) && !Number.isInteger(row[field])))) throw new Error('Estimation nutritionnelle V1 invalide.');
    }
    for (const field of ['nutrition_analysis_hash', 'nutrition_analysis_model', 'nutrition_analysis_confidence', 'nutrition_analysis_assumptions']) row[field] = text(rawDay[field]);
    row.nutrition_analyzed_at = rawDay.nutrition_analyzed_at ? stamp(rawDay.nutrition_analyzed_at) : null;
    row.sleep_duration_mode = ['sleep_hours','sleep_bedtime','sleep_wake_time'].some(key => row[key] !== null && row[key] !== undefined) ? 'imported' : 'calculated';
    row.nutrition_estimate_stale = 0; row.nutrition_inputs_revision = 1;
    row.nutrition_estimate_origin = ['kcal','sport_kcal_burned','proteins_g','carbs_g','fats_g'].some(key => row[key] !== null) ? 'v1' : 'none';
    validatePatch(Object.fromEntries(Object.entries(row).filter(([field]) => Object.hasOwn(dailyRules, field))));
    const progress = rawDay.checkin_completed_steps !== null && rawDay.checkin_completed_steps !== undefined ? rawDay : group.checkin_progress?.[0];
    if (progress) Object.assign(row, convertV1Progress(progress));
    else {
      const completed = [
        ['sleep_hours', 'sleep_bedtime', 'sleep_wake_time', 'nap_minutes'], ['alcohol_glasses'], ['weight_kg'], ['body_fat_pct'], ['belly_cm'],
        ['work_mode', 'work_start_time', 'work_end_time', 'work_duration_minutes'], [], ['phone_minutes'], ['meal_breakfast','meal_lunch','meal_dinner','meal_other'],
        ['me_time_writing_minutes','me_time_meditation_minutes','me_time_relaxation_minutes','me_time_outings_minutes'], ['self_listening_score','close_relations_listening_score'], [], [],
      ].flatMap((fields, index) => fields.some(field => row[field] !== null && row[field] !== undefined && row[field] !== '') ? [index] : []);
      if (group.sport_sessions?.length || rawDay.sport_hours !== null && rawDay.sport_hours !== undefined) completed.push(6);
      if (group.social_logs?.length) completed.push(11);
      if (group.goal_logs?.length) completed.push(12);
      Object.assign(row, convertV1Progress({ version: 5, completed_steps: JSON.stringify(completed), skipped_steps: '[]' }));
      warn('progress_inferred');
    }
    add('daily_entries', unit, row);
    const accounted = [...JSON.parse(String(row.completed_steps)), ...JSON.parse(String(row.skipped_steps))];
    const nextStep = row.checkin_finished === 1 ? 'summary' : indicatorIds.find(step => !accounted.includes(step)) ?? 'summary';
    add('settings', unit, { key: `checkin.position:${day}`, value: JSON.stringify({ version: 1, step: nextStep, revision: 1 }), updated_at: source.createdAt });
    let sessions = group.sport_sessions ?? [];
    if (sessions.length && rawDay.sport_hours !== null && rawDay.sport_hours !== undefined) {
      const legacyMinutes = minutes(rawDay.sport_hours);
      const durations = sessions.map(item => numeric(item.duration_minutes)).filter(value => value !== null);
      if (!durations.length || durations.reduce((sum, value) => sum + value, 0) !== legacyMinutes) warn('sport_summary_archived');
    }
    if (!sessions.length && (rawDay.sport_hours !== null && rawDay.sport_hours !== undefined || rawDay.sport_type)) {
      sessions = [{ entry_date: day, session_index: 1, sport_type: text(rawDay.sport_type), duration_minutes: minutes(rawDay.sport_hours), distance_km: null }];
      warn('legacy_sport_session_created');
    }
    for (const session of sessions) {
      const position = Number(session.session_index), duration = numeric(session.duration_minutes), distance = numeric(session.distance_km), type = text(session.sport_type);
      if ((duration !== null && (!Number.isInteger(duration) || duration < 0 || duration > 600)) ||
          (distance !== null && (distance < 0 || distance > 200)) || (type !== null && !SPORT_TYPES.includes(type as typeof SPORT_TYPES[number]))) throw new Error('Séance V1 incompatible.');
      add('sport_sessions', unit, { session_id: await uuid('sport_sessions', canonical([day, position])), entry_id: id, position, sport_type: type,
        duration_minutes: duration, distance_km: distance, revision: 1, created_at: source.createdAt, updated_at: source.createdAt });
    }
    for (const log of group.social_logs ?? []) {
      const friend = sourceId(log.friend_id);
      if (log.context === null || log.context === undefined) warn('social_context_defaulted');
      add('social_logs', unit, { social_log_id: await uuid('social_logs', sourceId(log.id)), entry_id: id, friend_id: await uuid('friends', friend),
        context: text(log.context, 'Vu en personne'), duration_minutes: minutes(log.duration_hours), note: text(log.note), included: 1, revision: 1,
        created_at: stamp(log.updated_at), updated_at: stamp(log.updated_at) });
    }
    for (const log of group.goal_logs ?? []) {
      const goal = sourceId(log.goal_id);
      add('goal_logs', unit, { goal_log_id: await uuid('goal_logs', canonical([day, goal])), entry_id: id, goal_id: await uuid('goals', goal),
        worked: flag(log.worked, 0), note: text(log.note), revision: 1, created_at: stamp(log.updated_at), updated_at: stamp(log.updated_at) });
    }
  }
  for (const table of ['todo_categories', 'todo_items', 'api_usage_logs', 'schema_migrations'] as const) if (source.tables[table].length) plan.warnings[`${table}_archived`] = source.tables[table].length;
  return plan;
}
