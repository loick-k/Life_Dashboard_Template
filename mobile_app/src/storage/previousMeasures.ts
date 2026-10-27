import type { QueryConnection } from './catalogs';
import { validateDate } from './dailyEntries.ts';

export const bodyMeasures = ['weight_kg', 'body_fat_pct', 'belly_cm'] as const;
export type BodyMeasure = typeof bodyMeasures[number];
export interface PreviousMeasure { date: string; value: number }
export async function previousMeasure(database: QueryConnection, field: BodyMeasure, beforeDate: string): Promise<PreviousMeasure | null> {
  validateDate(beforeDate);
  if (!bodyMeasures.includes(field)) throw new Error('Mesure inconnue');
  const row = await database.getFirstAsync<{ entry_date: string; value: number }>(
    `SELECT entry_date, ${field} AS value FROM daily_entries WHERE entry_date < ? AND ${field} IS NOT NULL ORDER BY entry_date DESC LIMIT 1`, beforeDate);
  if (!row) return null;
  if (!Number.isFinite(row.value)) throw new Error('Mesure illisible');
  return { date: row.entry_date, value: row.value };
}
