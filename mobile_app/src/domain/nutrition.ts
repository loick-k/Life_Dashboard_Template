export const estimateFields = ['kcal', 'sport_kcal_burned', 'proteins_g', 'carbs_g', 'fats_g'] as const;
export const nutritionInputFields = ['meal_breakfast', 'meal_lunch', 'meal_dinner', 'meal_other', 'weight_kg', 'body_fat_pct', 'belly_cm'] as const;
export function hasEstimate(row: Record<string, unknown>): boolean { return estimateFields.some(key => typeof row[key] === 'number'); }
export function nutritionStatus(row: Record<string, unknown>): 'unavailable' | 'stale' | 'available' {
  return !hasEstimate(row) ? 'unavailable' : row.nutrition_estimate_stale === 1 ? 'stale' : 'available';
}
/** Known metadata for pre-005 snapshots; preserve all historical values without recalculation. */
export function legacyDerivationMetadata(row: Record<string, unknown>) {
  return { sleep_duration_mode: ['sleep_hours', 'sleep_bedtime', 'sleep_wake_time'].some(key => row[key] !== null && row[key] !== undefined) ? 'imported' : 'calculated',
    nutrition_estimate_stale: 0, nutrition_inputs_revision: 1, nutrition_estimate_origin: hasEstimate(row) ? 'legacy' : 'none' };
}
