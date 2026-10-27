import { shiftDate } from './dates.ts';
import { validateDate } from '../storage/dailyEntries.ts';
import { estimateFields, hasEstimate } from './nutrition.ts';
import { inspectWorkSchedule, workBalance, type WorkTimes } from './work.ts';

type Aggregation = 'sum' | 'mean' | 'latest';
const metric = (key: string, label: string, group: string, unit: string, aggregate: Aggregation = 'sum') => ({ key, label, group, unit, aggregate });
export const weeklyMetrics = [
  metric('weight_kg', 'Poids', 'Corps', 'kg', 'latest'),
  metric('body_fat_pct', 'Masse graisseuse', 'Corps', '%', 'latest'),
  metric('belly_cm', 'Tour de ventre', 'Corps', 'cm', 'latest'),
  metric('sleep_hours', 'Sommeil', 'Sommeil', 'h', 'mean'),
  metric('nap_minutes', 'Sieste', 'Sommeil', 'min'),
  metric('alcohol_glasses', 'Verres saisis', 'Alcool', 'verres'),
  metric('work_duration_minutes', 'Durée de travail renseignée', 'Travail', 'min'),
  metric('work_balance_minutes', 'Avance / retard des journées renseignées', 'Travail', 'min'),
  metric('sport_minutes', 'Durée sportive renseignée', 'Sport', 'min'),
  metric('sport_distance_km', 'Distance sportive renseignée', 'Sport', 'km'),
  metric('sport_count', 'Séances renseignées', 'Sport', 'séances'),
  metric('sport_partial_count', 'Séances à durée manquante', 'Sport', 'séances'),
  metric('phone_minutes', 'Temps de portable', 'Portable', 'min/j', 'mean'),
  metric('kcal', 'Calories alimentaires estimées', 'Alimentation', 'kcal', 'mean'),
  metric('sport_kcal_burned', 'Calories sportives estimées', 'Alimentation', 'kcal', 'mean'),
  metric('net_kcal', 'Kcal nettes estimées', 'Alimentation', 'kcal', 'mean'),
  metric('proteins_g', 'Protéines estimées', 'Alimentation', 'g', 'mean'),
  metric('carbs_g', 'Glucides estimés', 'Alimentation', 'g', 'mean'),
  metric('fats_g', 'Lipides estimés', 'Alimentation', 'g', 'mean'),
  metric('me_time_writing_minutes', 'Écriture', 'Temps pour moi', 'min'),
  metric('me_time_meditation_minutes', 'Méditation', 'Temps pour moi', 'min'),
  metric('me_time_relaxation_minutes', 'Détente', 'Temps pour moi', 'min'),
  metric('me_time_outings_minutes', 'Sorties', 'Temps pour moi', 'min'),
  metric('me_time_total', 'Temps pour moi renseigné', 'Temps pour moi', 'min'),
  metric('self_listening_score', 'Écoute de soi', 'Écoute', '/10', 'mean'),
  metric('close_relations_listening_score', 'Écoute de mes proches', 'Écoute', '/10', 'mean'),
  metric('social_count', 'Interactions saisies', 'Social', 'interactions'),
  metric('social_minutes', 'Durée sociale renseignée', 'Social', 'min'),
  metric('goals_worked', 'Objectifs travaillés saisis', 'Objectifs', 'objectifs'),
] as const;
export type MetricDefinition = typeof weeklyMetrics[number];
export type MetricRow = { entry_date: string; [key: string]: string | number | null };
export type MetricSeries = MetricDefinition & {
  value: number | null; count: number;
  excludedEstimates: number;
  points: { date: string; value: number | null; future: boolean }[];
};

export function numericMetric(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Indicateur enregistré invalide.');
  return value;
}
const numeric = numericMetric;
/** Derive daily values before grouping: never pair calories from different days. */
export function prepareMetricRow(row: MetricRow): MetricRow {
  const usable = row.nutrition_estimate_stale !== 1;
  const kcal = usable ? numeric(row.kcal) : null, sportKcal = usable ? numeric(row.sport_kcal_burned) : null;
  const me = ['writing', 'meditation', 'relaxation', 'outings'].map(name => numeric(row[`me_time_${name}_minutes`])).filter(value => value !== null);
  const work = inspectWorkSchedule(row as WorkTimes).issue === 'overlap' ? null : numeric(row.work_duration_minutes);
  if (work !== null && (!Number.isSafeInteger(work) || work < 0)) throw new Error('Durée de travail invalide');
  const observed: Record<string, number | null> = {};
  // SQL COUNT returns zero for untouched categories too. Only explicit daily tracking
  // or a retained journal makes that zero an observation; opening a day is not one.
  if (row.completed_steps !== undefined) {
    let completed: unknown;
    try { completed = JSON.parse(String(row.completed_steps)); } catch { completed = []; }
    const done = (key: string) => Array.isArray(completed) && completed.includes(key);
    if (row.sport_count === 0 && !done('sport')) { observed.sport_count = null; observed.sport_partial_count = null; }
    if (row.social_count === 0 && Number(row.social_log_count ?? 0) === 0 && !done('social')) observed.social_count = null;
    if (row.goal_count === 0 && !done('goals')) observed.goals_worked = null;
  }
  return { ...row,
    ...observed,
    ...(!usable ? Object.fromEntries(estimateFields.map(key => [key, null])) : {}),
    has_nutrition_estimate: row.has_nutrition_estimate ?? (hasEstimate(row) ? 1 : 0),
    net_kcal: kcal !== null && sportKcal !== null ? kcal - sportKcal : null,
    me_time_total: me.length ? me.reduce((sum, value) => sum + value, 0) : null,
    work_duration_minutes: work, work_balance_minutes: workBalance(work, row.work_mode === 'Day off') };
}
export function weeklySeries(rows: readonly MetricRow[], date: string): MetricSeries[] {
  validateDate(date);
  const monday = shiftDate(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7));
  const indexed = new Map<string, MetricRow>();
  for (const row of rows) {
    validateDate(row.entry_date);
    if (row.entry_date < monday || row.entry_date > date) continue;
    if (indexed.has(row.entry_date)) throw new Error('Journée dupliquée.');
    indexed.set(row.entry_date, prepareMetricRow(row));
  }
  return weeklyMetrics.map(definition => {
    const points = Array.from({ length: 7 }, (_, index) => {
      const day = shiftDate(monday, index);
      return { date: day, value: numeric(indexed.get(day)?.[definition.key]), future: day > date };
    });
    const values = points.map(point => point.value).filter(value => value !== null);
    let value: number | null = null;
    if (values.length) value = definition.aggregate === 'latest' ? values.at(-1)!
      : values.reduce((sum, item) => sum + item, 0) / (definition.aggregate === 'mean' ? values.length : 1);
    const excludedEstimates = definition.group === 'Alimentation' ? [...indexed.values()].filter(row => row.nutrition_estimate_stale === 1 && row.has_nutrition_estimate === 1).length : 0;
    return { ...definition, points, value, count: values.length, excludedEstimates };
  });
}

export function formatMetric(value: number | null): string {
  return value === null ? 'n.c.' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value);
}
