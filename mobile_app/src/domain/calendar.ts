import { validateDate } from '../storage/dailyEntries.ts';
export function adjacentMonth(month: string, offset: number): string {
  validateDate(`${month}-01`);
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1 + offset;
  const year = Math.floor(index / 12), nextMonth = index % 12 + 1;
  if (year < 1 || year > 9999) throw new Error('Année hors limites');
  return `${String(year).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}`;
}
export function calendarCells(month: string): (string | null)[] {
  validateDate(`${month}-01`);
  const first = new Date(`${month}-01T12:00:00Z`), weekday = (first.getUTCDay() + 6) % 7;
  const last = new Date(first); last.setUTCMonth(last.getUTCMonth() + 1); last.setUTCDate(0);
  return Array.from({ length: 42 }, (_, index) => {
    const day = index - weekday + 1;
    return day < 1 || day > last.getUTCDate() ? null : `${month}-${String(day).padStart(2, '0')}`;
  });
}
