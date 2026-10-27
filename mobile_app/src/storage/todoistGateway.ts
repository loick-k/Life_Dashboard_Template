import type { SqlConnection } from './migrations';
import { TodoistClient, type TodoistFetch } from '../integrations/todoistClient.ts';
import { object, todoistId, todoistToken, TodoistError } from '../integrations/todoistTypes.ts';
import { commandFor, type TodoistAction } from '../integrations/todoistCommands.ts';
import { TodoistOutbox, type PendingTodoist } from './todoistOutbox.ts';

export interface TodoistVault { read(): Promise<string | null>; write(value: string): Promise<void>; remove(): Promise<void> }
interface Connection { version: 1; owner: string; token: string }
/** Tokens live only in the vault. A pending command can never cross authenticated accounts. */
export class TodoistGateway {
  #vault: TodoistVault; #fetch: TodoistFetch; readonly outbox: TodoistOutbox;
  constructor(database: SqlConnection, vault: TodoistVault, fetcher: TodoistFetch, uuid: () => string) { this.#vault = vault; this.#fetch = fetcher; this.outbox = new TodoistOutbox(database, uuid); }
  private async connection(): Promise<Connection | null> {
    try {
      const raw = await this.#vault.read(); if (raw === null) return null;
      if (raw.length > 2000) throw new Error(); const data = object(JSON.parse(raw));
      if (data.version !== 1 || Object.keys(data).sort().join(',') !== 'owner,token,version') throw new Error();
      return { version: 1, owner: todoistId(data.owner), token: todoistToken(data.token as string) };
    } catch { throw new TodoistError('configuration'); }
  }
  async status() { const [connection, pending] = await Promise.all([this.connection(), this.outbox.get()]); return { configured: connection !== null, account: connection?.owner ?? null, pending, matchingAccount: !pending || connection?.owner === pending.owner }; }
  async client(): Promise<TodoistClient> {
    const connection = await this.connection(); if (!connection) throw new TodoistError('configuration'); return new TodoistClient(connection.token, this.#fetch);
  }
  async configure(token: string): Promise<void> {
    const value = todoistToken(token), owner = await new TodoistClient(value, this.#fetch).userId();
    const pending = await this.outbox.get(); if (pending && pending.owner !== owner) throw new TodoistError('pending');
    const raw = JSON.stringify({ version: 1, owner, token: value });
    try { await this.#vault.write(raw); if (await this.#vault.read() !== raw) throw new Error(); } catch { throw new TodoistError('configuration'); }
  }
  async disconnect(): Promise<void> {
    if (await this.outbox.get()) throw new TodoistError('pending');
    try { await this.#vault.remove(); if (await this.#vault.read() !== null) throw new Error(); } catch { throw new TodoistError('configuration'); }
  }
  private async dispatch(pending: PendingTodoist): Promise<void> {
    if (pending.state === 'acknowledged') { await this.outbox.clear(pending.id); return; }
    if (pending.state === 'rejected') throw new TodoistError('rejected');
    const connection = await this.connection(); if (!connection || connection.owner !== pending.owner) throw new TodoistError('configuration');
    try { await new TodoistClient(connection.token, this.#fetch).send(commandFor(pending.action, pending.id, pending.temporaryId)); }
    catch (issue) { if (issue instanceof TodoistError && issue.kind === 'rejected') await this.outbox.mark(pending.id, 'rejected'); throw issue; }
    await this.outbox.mark(pending.id, 'acknowledged'); await this.outbox.clear(pending.id);
  }
  async perform(action: TodoistAction): Promise<void> {
    const connection = await this.connection(); if (!connection) throw new TodoistError('configuration');
    const pending = await this.outbox.prepare(connection.owner, action); await this.dispatch(pending);
  }
  async retry(): Promise<void> { const pending = await this.outbox.get(); if (!pending) throw new TodoistError('pending'); await this.dispatch(pending); }
  async abandon(id: string): Promise<void> { await this.outbox.clear(id); } // User confirmation belongs to the UI; never undoes the remote action.
}
