import { SportDraft, type SportSessions, type SportSession, type SportPatch } from './sportSessions.ts';

/** Explicit decisions only. Even choosing database values must check the reviewed revision. */
export async function resolveSportDraft(repository: SportSessions, latest: SportSession, pending: SportPatch, keepDraft: readonly string[]): Promise<SportDraft> {
  if (keepDraft.some(key => !Object.hasOwn(pending, key)) || new Set(keepDraft).size !== keepDraft.length) throw new Error('Choix de résolution invalide.');
  const patch = Object.fromEntries(keepDraft.map(key => [key, pending[key as keyof SportPatch]]));
  return new SportDraft(repository, await repository.patch(latest.session_id, latest.revision, patch));
}
