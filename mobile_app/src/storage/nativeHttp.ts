import type { TodoistFetch } from '../integrations/todoistClient';
/** Single native network port; tests replace it, never call the real network. */
export const nativeFetch: TodoistFetch = (url, options) => fetch(url, options);
