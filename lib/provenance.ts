import type { TraceStep } from './traceEngine';

type SourceIndex = Map<string, Map<number, number[]>>;
interface ProvenanceIndex {
  tuples: SourceIndex;
  results: SourceIndex;
}

// Trace steps are immutable. Keep the index only as long as its step is alive,
// and build it on first inspection so playback itself pays no indexing cost.
const indexes = new WeakMap<TraceStep, ProvenanceIndex>();

function add(index: SourceIndex, table: string, rid: number, position: number) {
  let tableRows = index.get(table);
  if (!tableRows) index.set(table, (tableRows = new Map()));
  let positions = tableRows.get(rid);
  if (!positions) tableRows.set(rid, (positions = []));
  // A self-join can mention the same source row in both aliases.
  if (positions[positions.length - 1] !== position) positions.push(position);
}

function indexFor(step: TraceStep): ProvenanceIndex {
  const cached = indexes.get(step);
  if (cached) return cached;
  const index: ProvenanceIndex = { tuples: new Map(), results: new Map() };
  step.tuples?.forEach((tuple, position) => {
    for (const [alias, rid] of Object.entries(tuple)) {
      if (rid !== null) add(index.tuples, step.tupleTables?.[alias] ?? alias, rid, position);
    }
  });
  step.resultRowSources?.forEach((sources, position) => {
    for (const [table, rids] of Object.entries(sources)) {
      for (const rid of rids) add(index.results, table, rid, position);
    }
  });
  indexes.set(step, index);
  return index;
}

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
  const index = indexFor(step);
  const tableOf = (alias: string) => step.tupleTables?.[alias] ?? alias;
  for (const position of index.tuples.get(table)?.get(rid) ?? []) {
    const tuple = step.tuples![position];
    for (const [alias, relatedRid] of Object.entries(tuple)) {
      if (relatedRid === null) continue;
      (rows[tableOf(alias)] ??= new Set()).add(relatedRid);
    }
  }

  const resultRows = new Set(index.results.get(table)?.get(rid));
  return { rows, resultRows };
}
