import type { QueryConnection } from './catalogs';
import type { SportSession } from './sportSessions';

export type SocialSummary = { id: string; name: string; category: string; context: string; duration_minutes: number | null; note: string | null };
export type GoalSummary = { id: string; title: string; worked: number; note: string | null };
export interface RelatedSummary { sports: SportSession[]; social: SocialSummary[]; goals: GoalSummary[] }

/** Read-only: includes archived subjects in history, excludes only entirely empty sports. */
export async function readRelatedSummary(db: QueryConnection, entryId: string): Promise<RelatedSummary> {
  const [sports, social, goals] = await Promise.all([
    db.getAllAsync<SportSession>('SELECT * FROM sport_sessions WHERE entry_id = ? AND (sport_type IS NOT NULL OR duration_minutes IS NOT NULL OR distance_km IS NOT NULL) ORDER BY position', entryId),
    db.getAllAsync<SocialSummary>('SELECT l.social_log_id AS id, f.name, f.category, l.context, l.duration_minutes, l.note FROM social_logs l JOIN friends f ON f.friend_id = l.friend_id WHERE l.entry_id = ? ORDER BY f.name COLLATE NOCASE, l.social_log_id', entryId),
    db.getAllAsync<GoalSummary>('SELECT l.goal_log_id AS id, g.title, l.worked, l.note FROM goal_logs l JOIN goals g ON g.goal_id = l.goal_id WHERE l.entry_id = ? ORDER BY g.title COLLATE NOCASE, l.goal_log_id', entryId),
  ]);
  return { sports, social, goals };
}
