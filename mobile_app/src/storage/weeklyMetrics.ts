import type { QueryConnection } from './catalogs';
import { validateDate } from './dailyEntries.ts';
import { shiftDate } from '../domain/dates.ts';
import { weeklySeries, type MetricRow } from '../domain/weeklyMetrics.ts';
import { Preferences } from './preferences.ts';

/** No cross-join of sport/social/goals: each one-to-many relation aggregates independently. */
export async function readWeeklyMetrics(database: QueryConnection, date: string) {
  validateDate(date);
  const monday = shiftDate(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7));
  const rows = await database.getAllAsync<MetricRow>(`SELECT d.entry_date,
    d.weight_kg, d.body_fat_pct, d.belly_cm, d.sleep_hours, d.nap_minutes, d.alcohol_glasses,
    d.phone_minutes, d.nutrition_estimate_stale,
    CASE WHEN d.kcal IS NOT NULL OR d.sport_kcal_burned IS NOT NULL OR d.proteins_g IS NOT NULL OR d.carbs_g IS NOT NULL OR d.fats_g IS NOT NULL THEN 1 ELSE 0 END AS has_nutrition_estimate,
    CASE WHEN d.nutrition_estimate_stale = 0 THEN d.kcal END AS kcal,
    CASE WHEN d.nutrition_estimate_stale = 0 THEN d.sport_kcal_burned END AS sport_kcal_burned,
    CASE WHEN d.nutrition_estimate_stale = 0 THEN d.proteins_g END AS proteins_g,
    CASE WHEN d.nutrition_estimate_stale = 0 THEN d.carbs_g END AS carbs_g,
    CASE WHEN d.nutrition_estimate_stale = 0 THEN d.fats_g END AS fats_g,
    d.me_time_writing_minutes, d.me_time_meditation_minutes, d.me_time_relaxation_minutes, d.me_time_outings_minutes,
    d.self_listening_score, d.close_relations_listening_score,
    (SELECT SUM(s.duration_minutes) FROM sport_sessions s WHERE s.entry_id = d.entry_id) AS sport_minutes,
    (SELECT SUM(s.distance_km) FROM sport_sessions s WHERE s.entry_id = d.entry_id) AS sport_distance_km,
    (SELECT COUNT(*) FROM sport_sessions s WHERE s.entry_id = d.entry_id AND
      (s.sport_type IS NOT NULL OR s.duration_minutes IS NOT NULL OR s.distance_km IS NOT NULL)) AS sport_count,
    (SELECT COUNT(*) FROM sport_sessions s WHERE s.entry_id = d.entry_id AND s.duration_minutes IS NULL AND
      (s.sport_type IS NOT NULL OR s.distance_km IS NOT NULL)) AS sport_partial_count,
    (SELECT COUNT(*) FROM social_logs l WHERE l.entry_id = d.entry_id) AS social_count,
    (SELECT SUM(l.duration_minutes) FROM social_logs l WHERE l.entry_id = d.entry_id) AS social_minutes,
    (SELECT COUNT(*) FROM goal_logs l WHERE l.entry_id = d.entry_id AND l.worked = 1) AS goals_worked
    FROM daily_entries d WHERE d.entry_date >= ? AND d.entry_date <= ? ORDER BY d.entry_date`, monday, date);
  const series = weeklySeries(rows, date);
  const label = await new Preferences(database).read('close_relations_label');
  return series.map(item => item.key === 'close_relations_listening_score' ? { ...item, label: String(label.value) } : item);
}
