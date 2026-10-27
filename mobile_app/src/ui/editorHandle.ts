/** Hidden editors keep their buffers. Destructive data replacement has a stricter barrier. */
export interface EditorHandle {
  settle(): Promise<void>;
  beforeReplace(): Promise<void>;
  hasUnconfirmed(): boolean;
}
