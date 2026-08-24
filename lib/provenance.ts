import type { TraceStep } from './traceEngine';

/** Everywhere a clicked source row contributes at the current trace step. */
export function provenanceFor(
  step: TraceStep,
  table: string,
  rid: number
): { rows: Record<string, Set<number>>; resultRows: Set<number> } {
  const rows: Record<string, Set<number>> = { [table]: new Set([rid]) };
  for (const tuple of step.tuples ?? []) {
    if (tuple[table] !== rid) continue;
    for (const [relatedTable, relatedRid] of Object.entries(tuple)) {
      if (relatedRid === null) continue;
      (rows[relatedTable] ??= new Set()).add(relatedRid);
    }
  }

  const resultRows = new Set<number>();
  (step.resultRowSources ?? []).forEach((sources, index) => {
    if (sources[table]?.includes(rid)) resultRows.add(index);
  });
  return { rows, resultRows };
}
