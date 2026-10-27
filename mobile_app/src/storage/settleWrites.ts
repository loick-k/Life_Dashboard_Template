/** A rejected write must not hide other operations that are still running. */
export async function settleWrites(operations: readonly Promise<unknown>[]): Promise<void> {
  const results = await Promise.allSettled(operations);
  const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failed) throw failed.reason;
}
