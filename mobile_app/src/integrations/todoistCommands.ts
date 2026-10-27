import { validateDate } from '../storage/dailyEntries.ts';
import { object, text, todoistId, TodoistError } from './todoistTypes.ts';

export type TodoistAction =
  | { kind: 'task.add'; content: string; projectId?: string; dueDate?: string; priority: number; labels?: string[] }
  | { kind: 'project.add'; name: string }
  | { kind: 'task.close' | 'task.delete' | 'task.reopen'; taskId: string }
  | { kind: 'task.update'; taskId: string; content?: string; priority?: number; labels?: string[]; dueDate?: string | null }
  | { kind: 'task.move'; taskId: string; projectId: string };
export interface TodoistCommand { type: string; uuid: string; temp_id?: string; args: Record<string, unknown> }
export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) throw new TodoistError('configuration'); return value;
}
export function commandFor(input: TodoistAction, commandId: string, temporaryId?: string): TodoistCommand {
  const source = object(input), kind = text(source.kind, 30), args: Record<string, unknown> = {};
  const fields: Record<string, string[]> = { 'task.add': ['content', 'projectId', 'dueDate', 'priority', 'labels'], 'project.add': ['name'], 'task.close': ['taskId'], 'task.delete': ['taskId'], 'task.reopen': ['taskId'], 'task.update': ['taskId', 'content', 'priority', 'labels', 'dueDate'], 'task.move': ['taskId', 'projectId'] };
  if (!Object.hasOwn(fields, kind) || Object.keys(source).some(key => key !== 'kind' && !fields[kind]!.includes(key))) throw new TodoistError('configuration');
  const nonempty = (value: unknown, max = 500) => { const result = text(value, max).trim(); if (!result) throw new TodoistError('configuration'); return result; };
  if (kind !== 'task.add' && kind !== 'project.add') args.id = todoistId(source.taskId);
  if (kind === 'project.add') args.name = nonempty(source.name, 200);
  if (source.content !== undefined) args.content = nonempty(source.content);
  if (kind === 'task.add' && args.content === undefined) throw new TodoistError('configuration');
  if (source.projectId !== undefined) args.project_id = todoistId(source.projectId);
  if (kind === 'task.move' && args.project_id === undefined) throw new TodoistError('configuration');
  if (source.priority !== undefined) { if (!Number.isInteger(source.priority) || Number(source.priority) < 1 || Number(source.priority) > 4) throw new TodoistError('configuration'); args.priority = source.priority; }
  if (kind === 'task.add' && args.priority === undefined) throw new TodoistError('configuration');
  if (source.labels !== undefined) { if (!Array.isArray(source.labels) || source.labels.length > 20) throw new TodoistError('configuration'); args.labels = [...new Set(source.labels.map(value => nonempty(value, 200)))]; }
  if (source.dueDate === null && kind === 'task.update') args.due = null;
  else if (source.dueDate !== undefined) { const date = text(source.dueDate, 10); try { validateDate(date); } catch { throw new TodoistError('configuration'); } args.due = { date }; }
  if (kind === 'task.update' && Object.keys(args).length === 1) throw new TodoistError('configuration');
  const types: Record<string, string> = { 'task.add': 'item_add', 'project.add': 'project_add', 'task.close': 'item_close', 'task.delete': 'item_delete', 'task.reopen': 'item_uncomplete', 'task.update': 'item_update', 'task.move': 'item_move' };
  const create = kind === 'task.add' || kind === 'project.add';
  return { type: types[kind]!, uuid: uuid(commandId), ...(create ? { temp_id: uuid(temporaryId) } : {}), args };
}
