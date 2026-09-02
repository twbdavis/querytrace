import type { TraceStep } from './traceEngine';

/**
 * Everywhere a clicked source row contributes at the current trace step.
 * Pipeline tuples are keyed by the alias each table was given in the query
 * (`FROM ASTRONOMER a`), so they are mapped back to canonical table names
 * through the step's alias map; a self-join therefore lights both roles.
 */
export function provenanceFor(
  step: TraceStep,
  table: string,
  rid: number
): { rows: Record<string, Set<number>>; resultRows: Set<number> } {
  const rows: Record<string, Set<number>> = { [table]: new Set([rid]) };
  const tableOf = (alias: string) => step.tupleTables?.[alias] ?? alias;
  for (const tuple of step.tuples ?? []) {
    const involved = Object.entries(tuple).some(
      ([alias, tupleRid]) => tupleRid === rid && tableOf(alias) === table
    );
    if (!involved) continue;
    for (const [alias, relatedRid] of Object.entries(tuple)) {
      if (relatedRid === null) continue;
      (rows[tableOf(alias)] ??= new Set()).add(relatedRid);
    }
  }

  const resultRows = new Set<number>();
  (step.resultRowSources ?? []).forEach((sources, index) => {
    if (sources[table]?.includes(rid)) resultRows.add(index);
  });
  return { rows, resultRows };
}
