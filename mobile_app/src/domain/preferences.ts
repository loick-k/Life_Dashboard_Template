export type PreferenceValue = string | number | null;
export interface PreferenceDefinition {
  key: string;
  label: string;
  kind: 'number' | 'time' | 'text' | 'date';
  initial: PreferenceValue;
  min?: number;
  max?: number;
  integer?: boolean;
  optional?: boolean;
}

/** V1 keys and hours are retained for lossless import; calculations convert to minutes. */
export const preferenceDefinitions = [
  { key: 'belly_goal_cm', label: 'Objectif tour de ventre (cm) · facultatif, 0 désactive', kind: 'number', initial: null, min: 0, max: 200, optional: true },
  { key: 'sleep_min_hours', label: 'Sommeil cible min (h)', kind: 'number', initial: 7, min: 0, max: 12 },
  { key: 'phone_max_hours', label: 'Portable max moyen (h/j)', kind: 'number', initial: 3, min: 0, max: 24 },
  { key: 'sport_weekly_goal_hours', label: 'Sport cible (h/semaine)', kind: 'number', initial: 3, min: 0, max: 20 },
  { key: 'social_weekly_goal_days', label: 'Objectif social : jours avec interaction / semaine', kind: 'number', initial: 2, min: 0, max: 7, integer: true },
  { key: 'work_weekly_target_hours', label: 'Objectif travail (h/semaine)', kind: 'number', initial: 35, min: 0, max: 80 },
  { key: 'work_days_per_week', label: 'Nombre de jours de travail de référence / semaine', kind: 'number', initial: 5, min: 1, max: 7, integer: true },
  { key: 'close_relations_label', label: 'Libellé de la seconde note d’écoute', kind: 'text', initial: 'Écoute de mes proches' },
  { key: 'tobacco_stop_date', label: 'Date d’arrêt du tabac (AAAA-MM-JJ) · facultative', kind: 'date', initial: null, optional: true },
  { key: 'work_standard_start', label: 'Début standard (HH:MM)', kind: 'time', initial: '08:30' },
  { key: 'work_standard_morning_end', label: 'Fin de matinée standard (HH:MM)', kind: 'time', initial: '12:30' },
  { key: 'work_standard_afternoon_start', label: 'Reprise standard (HH:MM)', kind: 'time', initial: '13:30' },
  { key: 'work_standard_end', label: 'Fin standard (HH:MM)', kind: 'time', initial: '17:30' },
] as const satisfies readonly PreferenceDefinition[];
export type PreferenceKey = typeof preferenceDefinitions[number]['key'];

export function preferenceDefinition(key: string): PreferenceDefinition {
  const definition = preferenceDefinitions.find(item => item.key === key);
  if (!definition) throw new Error('Réglage inconnu. Les secrets ne sont pas des préférences.');
  return definition;
}

export function validatePreference(key: string, value: unknown): PreferenceValue {
  const definition = preferenceDefinition(key);
  if (value === null && definition.optional) return null;
  if (definition.kind === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < definition.min! || value > definition.max! ||
        (definition.integer && !Number.isInteger(value))) throw new Error('Valeur hors limites.');
    return value;
  }
  if (typeof value !== 'string') throw new Error('Format invalide.');
  if (definition.kind === 'time' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return value;
  if (definition.kind === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T12:00:00Z`);
    if (!Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value) return value;
  }
  if (definition.kind === 'text' && value.trim().length > 0 && value.length <= 200) return value.trim();
  throw new Error('Format invalide.');
}

/** Empty or unfinished text is a draft, never an implicit deletion. */
export function parsePreference(key: PreferenceKey, raw: string): PreferenceValue {
  const definition = preferenceDefinition(key);
  if (definition.kind !== 'number') return validatePreference(key, raw.trim());
  if (!/^\d+(?:[.,]\d+)?$/.test(raw.trim())) throw new Error('Nombre incomplet.');
  return validatePreference(key, Number(raw.trim().replace(',', '.')));
}
