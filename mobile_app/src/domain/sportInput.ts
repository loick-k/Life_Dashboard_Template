import { parseInput } from './input.ts';

/** Validate the pair, not only the last edited field. Empty companion means zero,
 * but two empty fields remain absence rather than an invented zero-minute session. */
export function parseSportDuration(hoursText: string, minutesText: string): { valid: boolean; minutes: number | null } {
  if (!hoursText.trim() && !minutesText.trim()) return { valid: false, minutes: null };
  const hours = hoursText.trim() ? parseInput(hoursText, 'number') : 0;
  const minutes = minutesText.trim() ? parseInput(minutesText, 'number') : 0;
  const valid = typeof hours === 'number' && typeof minutes === 'number' && Number.isInteger(hours) &&
    Number.isInteger(minutes) && minutes < 60 && hours * 60 + minutes <= 600;
  return { valid, minutes: valid ? Number(hours) * 60 + Number(minutes) : null };
}
