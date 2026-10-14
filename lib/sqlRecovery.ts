/** A change committed before its recovery snapshot could be produced. */
export class RecoveryRequiredError extends Error {
  constructor(cause: unknown) {
    super('The change could not be confirmed because its recovery snapshot failed.', { cause });
    this.name = 'RecoveryRequiredError';
  }
}

/** sql.js export closes/reopens the connection, so snapshots follow commit. */
export function snapshotAfterCommit(exportSnapshot: () => Uint8Array): Uint8Array {
  try { return exportSnapshot(); }
  catch (error) { throw new RecoveryRequiredError(error); }
}
