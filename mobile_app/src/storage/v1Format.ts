import { preferenceDefinitions } from '../domain/preferences.ts';

export const v1Tables = ['daily_entries', 'sport_sessions', 'friends', 'social_logs', 'goals', 'goal_logs', 'settings',
  'checkin_progress', 'api_usage_logs', 'schema_migrations', 'todo_categories', 'todo_items'] as const;
export type V1Table = typeof v1Tables[number];
export type V1Row = Record<string, string | number | boolean | null>;
export interface V1Bundle {
  format: 'life-dashboard-v1-export'; version: 1; sourceId: string; createdAt: string;
  excludedSettings?: number;
  tables: Partial<Record<V1Table, { rows: V1Row[]; checksum: string }>>;
}
export interface V1Crypto { sha256(text: string): Promise<string> }
const columns: Record<V1Table, string[]> = {
  daily_entries: ('entry_date alcohol_glasses sleep_hours sleep_bedtime sleep_wake_time nap_minutes work_hours work_travel work_start_time work_morning_end_time work_afternoon_start_time work_end_time work_third_start_time work_third_end_time work_duration_hours weight_kg waist_cm belly_cm body_fat_pct sport_type sport_hours phone_hours kcal sport_kcal_burned proteins_g carbs_g fats_g meal_breakfast meal_lunch meal_dinner meal_other me_time_writing_minutes me_time_meditation_minutes me_time_relaxation_minutes me_time_outings_minutes self_listening_score close_relations_listening_score nutrition_analysis_hash nutrition_analysis_model nutrition_analysis_confidence nutrition_analysis_assumptions nutrition_analyzed_at checkin_completed_steps checkin_skipped_steps checkin_finished checkin_version updated_at').split(' '),
  sport_sessions: ['entry_date','session_index','session_id','sport_type','duration_minutes','distance_km'],
  friends: ['id','name','category','active','created_at'], social_logs: ['id','entry_date','friend_id','context','duration_hours','note','updated_at'],
  goals: ['id','title','active','created_at','completed_at'], goal_logs: ['entry_date','goal_id','worked','note','updated_at'],
  settings: ['key','value'], checkin_progress: ['entry_date','completed_steps','skipped_steps','finished','version','updated_at'],
  api_usage_logs: ['id','entry_date','provider','model','input_tokens','cached_input_tokens','output_tokens','estimated_cost_usd','estimated_cost_eur','usd_to_eur','created_at'],
  schema_migrations: ['migration_id','checksum','applied_at'], todo_categories: ['id','name','created_at'],
  todo_items: ['id','title','due_date','priority','completed','source','external_id','category_id','created_at','completed_at','updated_at'],
};
export const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
};
export async function parseV1Bundle(raw: string, crypto: V1Crypto) {
  if (new TextEncoder().encode(raw).length > 8 * 1024 * 1024) throw new Error('Export V1 trop volumineux.');
  const bundle = JSON.parse(raw) as V1Bundle;
  if (!bundle || bundle.format !== 'life-dashboard-v1-export' || bundle.version !== 1 ||
      typeof bundle.sourceId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(bundle.sourceId) ||
      typeof bundle.createdAt !== 'string' || !Number.isFinite(Date.parse(bundle.createdAt)) || !bundle.tables ||
      Object.keys(bundle.tables).some(table => !v1Tables.includes(table as V1Table))) throw new Error('Format V1 incompatible.');
  const tables = {} as Record<V1Table, V1Row[]>;
  if (bundle.excludedSettings !== undefined && (!Number.isSafeInteger(bundle.excludedSettings) || bundle.excludedSettings < 0 || bundle.excludedSettings > 100000)) throw new Error('Compteur de réglages invalide.');
  let count = 0, excludedSettings = bundle.excludedSettings ?? 0;
  for (const table of v1Tables) {
    const entry = bundle.tables[table];
    const rows = entry?.rows ?? [];
    if (!Array.isArray(rows) || (entry && (typeof entry.checksum !== 'string' || entry.checksum !== await crypto.sha256(canonical(rows))))) throw new Error(`Contrôle de fichier échoué : ${table}.`);
    count += rows.length;
    if (count > 100000) throw new Error('Export V1 trop volumineux.');
    for (const row of rows) if (!row || typeof row !== 'object' || Array.isArray(row) || Object.values(row).some(value =>
      value !== null && typeof value !== 'string' && typeof value !== 'boolean' && (typeof value !== 'number' || !Number.isFinite(value)))) throw new Error(`Ligne incompatible : ${table}.`);
    if (rows.some(row => Object.keys(row).some(key => !columns[table].includes(key)))) throw new Error(`Colonne source inconnue : ${table}.`);
    // Drop unrecognized settings before hashing/archiving; they may contain credentials.
    tables[table] = table === 'settings' ? rows.filter(row => {
      const allowed = preferenceDefinitions.some(item => item.key === row.key);
      if (!allowed) excludedSettings++;
      return allowed;
    }) : rows;
  }
  return { sourceId: bundle.sourceId, createdAt: new Date(bundle.createdAt).toISOString(), tables, excludedSettings,
    fingerprint: await crypto.sha256(canonical({ sourceId: bundle.sourceId, tables })) };
}

export async function v1Uuid(crypto: V1Crypto, source: string, table: string, key: string): Promise<string> {
  const hash = await crypto.sha256(canonical(['life-dashboard-v1', source, table, key]));
  const hex = hash.slice(0, 12) + '8' + hash.slice(13, 16) + ((parseInt(hash[16]!, 16) & 3) | 8).toString(16) + hash.slice(17, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
