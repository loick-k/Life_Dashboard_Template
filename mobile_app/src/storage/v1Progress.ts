import { indicatorIds } from './checkinProgress.ts';
import type { V1Row } from './v1Format';

/** Mirrors checkin/state.py progress migrations 1→5, then maps indices to V2 IDs. */
export function convertV1Progress(row: V1Row | undefined) {
  if (!row) return { completed_steps: '[]', skipped_steps: '[]', checkin_finished: 0, checkin_version: 5 };
  const legacyTable = Object.hasOwn(row, 'version') || Object.hasOwn(row, 'completed_steps') || Object.hasOwn(row, 'skipped_steps');
  let version = Number(legacyTable ? row.version ?? 1 : row.checkin_version ?? 5);
  if (!Number.isInteger(version) || version < 1 || version > 5) throw new Error('Version de progression inconnue.');
  const read = (raw: unknown) => {
    const items = raw === null || raw === undefined ? [] : typeof raw === 'string' ? JSON.parse(raw) : null;
    const max = [0, 10, 9, 10, 11, 12][version]!;
    if (!Array.isArray(items) || items.some(item => !Number.isInteger(item) || item < 0 || item > max) || new Set(items).size !== items.length) throw new Error('Progression V1 invalide.');
    return new Set<number>(items);
  };
  let completed = read(row.completed_steps ?? row.checkin_completed_steps), skipped = read(row.skipped_steps ?? row.checkin_skipped_steps);
  if ([...completed].some(item => skipped.has(item))) throw new Error('Progression V1 incohérente.');
  if (version === 1) {
    const c = new Set([...completed].filter(i => i <= 5)), s = new Set([...skipped].filter(i => i <= 5));
    if (completed.has(6) && completed.has(7)) c.add(6);
    else if ([6, 7].every(i => completed.has(i) || skipped.has(i))) s.add(6);
    for (const i of [8, 9, 10]) { if (completed.has(i)) c.add(i - 1); if (skipped.has(i)) s.add(i - 1); }
    completed = c; skipped = s; version++;
  }
  if (version === 2) {
    const c = new Set([...completed].filter(i => i <= 7)), s = new Set([...skipped].filter(i => i <= 7));
    if (completed.has(8) || skipped.has(8)) s.add(8);
    for (const i of [8, 9]) { if (completed.has(i)) c.add(i + 1); if (skipped.has(i)) s.add(i + 1); }
    completed = c; skipped = s; version++;
  }
  for (const [oldVersion, threshold] of [[3, 8], [4, 9]]) if (version === oldVersion) {
    const c = new Set([...completed].filter(i => i <= threshold!)), s = new Set([...skipped].filter(i => i <= threshold!));
    for (const i of [threshold! + 1, threshold! + 2]) { if (completed.has(i)) c.add(i + 1); if (skipped.has(i)) s.add(i + 1); }
    s.add(threshold! + 1); completed = c; skipped = s; version++;
  }
  return { completed_steps: JSON.stringify([...completed].sort((a,b) => a-b).map(i => indicatorIds[i])),
    skipped_steps: JSON.stringify([...skipped].sort((a,b) => a-b).map(i => indicatorIds[i])),
    checkin_finished: completed.size + skipped.size === 13 ? 1 : 0, checkin_version: 5 };
}
