import { validateDate } from '../storage/dailyEntries.ts';
import { parisDate } from '../domain/dates.ts';

export type TodoistErrorKind = 'network' | 'authentication' | 'rate' | 'forbidden' | 'response' | 'rejected' | 'pending' | 'configuration';
const messages: Record<TodoistErrorKind, string> = {
  network: 'Todoist est inaccessible ou le délai est dépassé. Aucune modification n’est annoncée comme confirmée.',
  authentication: 'Jeton Todoist invalide ou révoqué. Vérifie la connexion dans Réglages.',
  rate: 'Todoist limite les requêtes. Attends avant de réessayer ; aucun réessai automatique.',
  forbidden: 'Cette action Todoist est indisponible avec tes droits ou ton abonnement.',
  response: 'Réponse Todoist incompatible. Les données locales sont conservées.',
  rejected: 'Todoist a refusé cette commande. Abandonne son suivi avant de préparer une nouvelle action.',
  pending: 'Une commande Todoist reste à résoudre. Réessaie-la ou abandonne explicitement son suivi.',
  configuration: 'Connexion Todoist indisponible ou configuration incompatible. Aucun secret réinitialisé automatiquement.',
};
/** No server body, URL, task title or credential can become an exception message. */
export class TodoistError extends Error {
  readonly kind: TodoistErrorKind;
  constructor(kind: TodoistErrorKind) { super(messages[kind]); this.name = 'TodoistError'; this.kind = kind; }
}
export function todoistId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value) || value.startsWith('tmp-')) throw new TodoistError('response');
  return value;
}
export function todoistToken(value: string): string {
  if (typeof value !== 'string') throw new TodoistError('configuration');
  const token = value.trim();
  if (!/^[a-zA-Z0-9_-]{16,1024}$/.test(token)) throw new TodoistError('configuration');
  return token;
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TodoistError('response');
  return value as Record<string, unknown>;
}
export function text(value: unknown, maximum = 10000): string {
  if (typeof value !== 'string' || value.length > maximum) throw new TodoistError('response'); return value;
}
export interface TodoistProject { id: string; name: string; inbox: boolean }
export interface TodoistTask { id: string; content: string; projectId: string; priority: number; labels: string[]; dueDate: string | null; recurring: boolean; completedAt: string | null }
export interface TodoistPage<T> { results: T[]; nextCursor: string | null }
export function dueCalendarDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const raw = text(value, 80), date = raw.slice(0, 10);
  try { validateDate(date); } catch { throw new TodoistError('response'); }
  if (raw.length === 10) return date;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) throw new TodoistError('response');
  if (/Z$|[+-]\d{2}:\d{2}$/.test(raw)) {
    const instant = new Date(raw); if (!Number.isFinite(instant.valueOf())) throw new TodoistError('response'); return parisDate(instant);
  }
  return date;
}
export function parseTask(value: unknown): TodoistTask {
  const row = object(value), due = row.due === null || row.due === undefined ? null : object(row.due);
  const priority = row.priority ?? 1;
  if (!Number.isInteger(priority) || Number(priority) < 1 || Number(priority) > 4 || !Array.isArray(row.labels) || row.labels.length > 100) throw new TodoistError('response');
  const completedAt = row.completed_at === null || row.completed_at === undefined ? null : text(row.completed_at, 80);
  if (completedAt && (!/Z$|[+-]\d{2}:\d{2}$/.test(completedAt) || !Number.isFinite(new Date(completedAt).valueOf()))) throw new TodoistError('response');
  return { id: todoistId(row.id), projectId: todoistId(row.project_id), content: text(row.content), priority: Number(priority),
    labels: row.labels.map(label => text(label, 200)), dueDate: dueCalendarDate(due?.date), recurring: due?.is_recurring === true, completedAt };
}
