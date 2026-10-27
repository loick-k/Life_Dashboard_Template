import { validateDate } from '../storage/dailyEntries.ts';
import { inspectWorkSchedule, type WorkTimes } from './work.ts';
import { shiftDate } from './dates.ts';
import { preferenceDefinitions, validatePreference, type PreferenceKey, type PreferenceValue } from './preferences.ts';
import type { MetricRow } from './weeklyMetrics.ts';
import * as scores from './assessmentScores.ts';

export type AssessmentSettings = Partial<Record<PreferenceKey, PreferenceValue>>;
export interface AssessmentItem { key: string; label: string; score: number | null; comment: string; weight: number }
export interface WeeklyAssessment {
  date: string; monday: string; sunday: string; elapsedDays: number; score: number | null; label: string;
  items: AssessmentItem[]; observed: number; total: number; staleEstimates: number; excludedWorkDates: string[];
}
const numeric = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Valeur de bilan illisible');
  return value;
};
function values(rows: MetricRow[], key: string): number[] { return rows.map(row => numeric(row[key])).filter(value => value !== null); }
function sum(rows: MetricRow[], key: string): number | null { const known = values(rows, key); return known.length ? known.reduce((a, b) => a + b, 0) : null; }
function mean(rows: MetricRow[], key: string): number | null { const known = values(rows, key); return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null; }
function completed(row: MetricRow, section: string): boolean {
  const steps: unknown = JSON.parse(String(row.completed_steps ?? '[]'));
  if (!Array.isArray(steps)) throw new Error('Progression illisible');
  return steps.includes(section);
}

/** Read-only personal tracking, not a medical assessment. No missing dimension is scored as zero. */
export function buildWeeklyAssessment(source: readonly MetricRow[], date: string, settings: AssessmentSettings = {}): WeeklyAssessment {
  validateDate(date);
  const elapsedDays = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7 + 1;
  const monday = shiftDate(date, 1 - elapsedDays), seen = new Set<string>(), excludedWorkDates: string[] = [];
  const rows: MetricRow[] = [];
  let staleEstimates = 0;
  for (const row of [...source].sort((a, b) => a.entry_date.localeCompare(b.entry_date))) {
    validateDate(row.entry_date);
    if (row.entry_date < monday || row.entry_date > date) continue;
    if (seen.has(row.entry_date)) throw new Error('Journée dupliquée'); seen.add(row.entry_date);
    const next = { ...row };
    if (inspectWorkSchedule(row as WorkTimes).issue === 'overlap') { next.work_duration_minutes = null; excludedWorkDates.push(row.entry_date); }
    if (row.nutrition_estimate_stale === 1) {
      if (row.has_nutrition_estimate === 1 || ['kcal', 'sport_kcal_burned', 'proteins_g', 'carbs_g', 'fats_g'].some(key => row[key] !== null && row[key] !== undefined)) staleEstimates++;
      for (const key of ['kcal', 'sport_kcal_burned', 'proteins_g', 'carbs_g', 'fats_g']) next[key] = null;
    }
    rows.push(next);
  }
  const prefs = Object.fromEntries(preferenceDefinitions.map(item => [item.key, Object.hasOwn(settings, item.key) ? validatePreference(item.key, settings[item.key]) : item.initial])) as Record<PreferenceKey, PreferenceValue>;
  const number = (key: PreferenceKey) => Number(prefs[key]);
  const latest = (key: string) => values(rows, key).at(-1) ?? null;
  const items: AssessmentItem[] = [];
  const add = (key: string, label: string, score: scores.Score, weight: number) => items.push({ key, label, score: score[0], comment: score[1], weight });
  const stop = prefs.tobacco_stop_date;
  if (typeof stop === 'string' && stop <= date) {
    const days = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${stop}T12:00:00Z`)) / 86400000);
    add('tobacco', 'Tabac', scores.scoreTobacco(days), 0.8);
  } else add('tobacco', 'Tabac', [null, stop ? 'Date d’arrêt future : suivi pas encore commencé.' : 'Date d’arrêt du tabac non configurée.'], 0.8);
  add('alcohol', 'Alcool', scores.scoreAlcohol(sum(rows, 'alcohol_glasses')), 1);
  add('sleep', 'Sommeil', scores.scoreSleep(mean(rows, 'sleep_hours'), number('sleep_min_hours')), 1);
  add('weight', 'Poids · suivi', scores.scoreTracking(values(rows, 'weight_kg').length, elapsedDays, 'Poids'), 0.35);
  add('fat', 'Masse graisseuse · suivi', scores.scoreTracking(values(rows, 'body_fat_pct').length, elapsedDays, 'Masse graisseuse'), 0.35);
  const bellies = values(rows, 'belly_cm');
  add('belly', 'Tour de ventre', scores.scoreBody(latest('belly_cm'), latest('weight_kg'), latest('body_fat_pct'), prefs.belly_goal_cm as number | null, bellies.length > 1 ? bellies.at(-1)! - bellies[0]! : null), 0.6);
  const work = sum(rows, 'work_duration_minutes');
  add('work', 'Travail', scores.scoreWork(work === null ? null : work / 60, number('work_weekly_target_hours')), 0.8);
  // Coverage is useful but must not change V1's weighted formula or the fixed 7h42 counter.
  add('work_tracking', 'Travail · suivi', scores.scoreTracking(rows.filter(row => row.work_duration_minutes !== null && row.work_duration_minutes !== undefined && row.work_mode !== 'Day off').length, Math.min(elapsedDays, number('work_days_per_week')), 'Travail'), 0);
  const sportValues = rows.map(row => numeric(row.sport_minutes) ?? (completed(row, 'sport') && row.sport_count === 0 ? 0 : null)).filter(value => value !== null);
  const sport = sportValues.length ? sportValues.reduce((a, b) => a + b, 0) / 60 : null;
  add('sport', 'Sport', scores.scoreSport(sport, number('sport_weekly_goal_hours')), 1);
  const phone = mean(rows, 'phone_minutes');
  add('phone', 'Temps de portable', scores.scorePhone(phone === null ? null : phone / 60, number('phone_max_hours')), 0.9);
  const mealDays = rows.filter(row => ['meal_breakfast', 'meal_lunch', 'meal_dinner', 'meal_other'].some(key => typeof row[key] === 'string' && String(row[key]).trim()) || ['kcal', 'proteins_g', 'carbs_g', 'fats_g'].some(key => row[key] !== null && row[key] !== undefined)).length;
  add('nutrition', 'Alimentation · suivi', scores.scoreNutrition(mealDays), 0.45);
  for (const [key, label] of [['kcal', 'Calories'], ['proteins_g', 'Protéines'], ['carbs_g', 'Glucides'], ['fats_g', 'Lipides']] as const)
    add(key, `${label} · suivi`, scores.scoreTracking(values(rows, key).length, elapsedDays, label), 0.2);
  for (const [key, label] of [['writing', 'Écriture'], ['meditation', 'Méditation'], ['relaxation', 'Détente'], ['outings', 'Sorties']] as const)
    add(key, label, scores.scorePositiveTime(sum(rows, `me_time_${key}_minutes`), label), 0.45);
  add('listening_self', 'Écoute de soi', scores.scoreRating(mean(rows, 'self_listening_score'), 'Écoute de soi'), 0.7);
  const closeLabel = String(prefs.close_relations_label);
  add('listening_close', closeLabel, scores.scoreRating(mean(rows, 'close_relations_listening_score'), closeLabel), 0.7);
  const social = rows.filter(row => Number(row.social_count ?? 0) > 0 || Number(row.social_log_count ?? 0) > 0 || completed(row, 'social'));
  add('social', 'Social', scores.scoreSocial(social.length ? social.filter(row => Number(row.social_count ?? 0) > 0).length : null, number('social_weekly_goal_days')), 0.8);
  const goals = rows.filter(row => Number(row.goal_count ?? 0) > 0 || completed(row, 'goals'));
  add('goals', 'Objectifs', scores.scoreGoals(goals.filter(row => Number(row.goals_worked ?? 0) > 0).length, goals.length), 0.9);
  const observed = items.filter(item => item.score !== null && item.weight > 0);
  const weight = observed.reduce((total, item) => total + item.weight, 0);
  const score = weight ? scores.roundEven(observed.reduce((total, item) => total + item.score! * item.weight, 0) / weight) : null;
  return { date, monday, sunday: shiftDate(monday, 6), elapsedDays, score, label: scores.assessmentLabel(score), items,
    observed: observed.length, total: items.filter(item => item.weight > 0).length, staleEstimates, excludedWorkDates };
}
