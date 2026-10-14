/** Browser tracing keeps intermediate results, so database size alone is not a memory bound. */
export const MAX_VALUE_CHARS = 100_000;
export const MAX_VALUE_BYTES = 100_000;
export const MAX_RESULT_ROWS = 50_000;
export const MAX_RESULT_CELLS = 500_000;
export const MAX_RESULT_BYTES = 8 * 1024 * 1024;

export class ResourceLimitError extends Error {}

export function checkTextSize(length: number): void {
  if (!Number.isFinite(length) || length > MAX_VALUE_CHARS) {
    throw new ResourceLimitError(`A text value exceeds the ${MAX_VALUE_CHARS.toLocaleString()}-character browser limit. Use a smaller value.`);
  }
}

export function checkBlobSize(length: number): void {
  if (!Number.isFinite(length) || length > MAX_VALUE_BYTES) {
    throw new ResourceLimitError(`A binary value exceeds the ${MAX_VALUE_BYTES.toLocaleString()}-byte browser limit. Use a smaller value.`);
  }
}

interface ResultBudget { cells: number; bytes: number }
const budgets = new WeakMap<object, ResultBudget>();

/** One cumulative budget covers every intermediate query in a trace. */
export function withResultBudget<T>(database: object, run: () => T): T {
  const previous = budgets.get(database);
  budgets.set(database, { cells: 0, bytes: 0 });
  try { return run(); }
  finally {
    if (previous) budgets.set(database, previous);
    else budgets.delete(database);
  }
}

export function resultBudget(database: object): ResultBudget {
  return budgets.get(database) ?? { cells: 0, bytes: 0 };
}

export function accountResultRow(budget: ResultBudget, row: unknown[], count: number): void {
  budget.cells += row.length;
  for (const value of row) {
    if (typeof value === 'string') {
      checkTextSize(value.length);
      budget.bytes += value.length * 2;
    } else if (value instanceof Uint8Array) {
      checkBlobSize(value.byteLength);
      budget.bytes += value.byteLength;
    } else budget.bytes += 8;
  }
  if (count > MAX_RESULT_ROWS || budget.cells > MAX_RESULT_CELLS || budget.bytes > MAX_RESULT_BYTES) {
    throw new ResourceLimitError('This trace exceeds the browser result limit (50,000 rows per stage, 500,000 cells or 8 MB across intermediate results). Select fewer columns, filter earlier, or use a smaller schema.');
  }
}
