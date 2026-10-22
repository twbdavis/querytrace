'use client';

import { emptyRecord, ownValue } from '@/lib/records';
import { create } from 'zustand';
import type { TableData } from '@/lib/db';
import type { DialectNote } from '@/lib/dialect';
import {
  loadPersistedAppState,
  PersistenceConflictError,
  requestDurableStorage,
  savePersistedAppState,
} from '@/lib/persistence';
import { provenanceFor } from '@/lib/provenance';
import { quoteIdentIfNeeded } from '@/lib/sqlText';
import type { TraceStep } from '@/lib/traceEngine';
import { PRELOADED_SCHEMAS, schemaById, type FkEdgeDef, type SchemaDef, type TableMeta } from '@/lib/schemas';
import { loadSchemaInWorker, runQueryInWorker, WorkerRequestError } from '@/lib/sqlWorkerClient';

const MAX_QUERY_CHARS = 20_000;
let schemaLoadGeneration = 0;
let queryRunGeneration = 0;
let databaseOperations = Promise.resolve();
let customDraftDirty = false;

/** Persistence is part of a database operation, so its acknowledgment precedes the next request. */
function serializeDatabase<T>(operation: () => Promise<T>): Promise<T> {
  const pending = databaseOperations.then(operation);
  databaseOperations = pending.then(() => undefined, () => undefined);
  return pending;
}

export type Speed = 0.5 | 1 | 2;

export interface Selection {
  table: string;
  /** SQLite rowid of the selected row. */
  rid: number;
}

export interface LoadResult {
  ok: boolean;
  error?: string;
  /** Original text of the schema statement that failed, when one is to blame. */
  statement?: string;
  cancelled?: boolean;
}

interface AppState {
  dbReady: boolean;
  schemaLoading: boolean;
  dbError: string | null;

  schemaDef: SchemaDef;
  /** A successful reload replaces geometry and relationships, even with identical table names. */
  schemaRevision: number;
  savedCustomSchema: SchemaDef | null;
  savedCustomDatabase: Uint8Array | null;
  savedCustomRevision: number;
  /** Schema SQL being edited in the builder; survives closing the dialog and reloads. */
  customDdlDraft: string | null;
  schema: TableMeta[];
  fkEdges: FkEdgeDef[];
  tableData: Record<string, TableData>;

  sql: string;
  error: string | null;
  /** How the last run's dialect was rewritten for SQLite (empty for plain SQLite). */
  notes: DialectNote[];

  trace: TraceStep[] | null;
  /** The exact SQL text the current trace was built from. */
  tracedSql: string | null;
  currentStep: number;
  playing: boolean;
  /** True once auto-play has run to the end; cleared by any manual transport. */
  finished: boolean;
  speed: Speed;

  /** Pinned by click; survives until cleared or a new query runs. */
  selection: Selection | null;
  /** Transient hover over a canvas row; previews provenance. */
  hoveredRow: Selection | null;
  /** Transient hover over a result-panel row index. */
  hoveredResultRow: number | null;

  ranLessons: Record<string, boolean>;

  /** True while the SQL editor has focus; playback shortcuts are suspended. */
  editorFocused: boolean;

  init: () => Promise<void>;
  loadSchema: (def: SchemaDef, savedBytes?: Uint8Array) => Promise<LoadResult>;
  resumeCustomSchema: () => Promise<LoadResult>;
  setSql: (sql: string) => void;
  runQuery: (sql?: string) => Promise<void>;
  play: () => void;
  pause: () => void;
  stepForward: () => void;
  stepBack: () => void;
  reset: () => void;
  gotoStep: (i: number) => void;
  setSpeed: (s: Speed) => void;
  selectRow: (sel: Selection | null) => void;
  setHoveredRow: (sel: Selection | null) => void;
  setHoveredResultRow: (i: number | null) => void;
  markLessonRun: (id: string) => Promise<void>;
  setEditorFocused: (focused: boolean) => void;
  /** Keep the builder's unsaved SQL in memory (every keystroke). */
  setCustomDdlDraft: (ddl: string | null) => void;
  /** Write the current draft to storage (dialog close, build attempt). */
  persistCustomDdlDraft: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  dbReady: false,
  schemaLoading: false,
  dbError: null,

  schemaDef: PRELOADED_SCHEMAS[0],
  schemaRevision: 0,
  savedCustomSchema: null,
  savedCustomDatabase: null,
  savedCustomRevision: 0,
  customDdlDraft: null,
  schema: [],
  fkEdges: [],
  tableData: {},

  sql: PRELOADED_SCHEMAS[0].starterQuery,
  error: null,
  notes: [],

  trace: null,
  tracedSql: null,
  currentStep: 0,
  playing: false,
  finished: false,
  speed: 1,

  selection: null,
  hoveredRow: null,
  hoveredResultRow: null,
  ranLessons: {},
  editorFocused: false,

  init: async () => {
    if (get().dbReady || get().schemaLoading) return;
    const persisted = await loadPersistedAppState();
    if (persisted) {
      set({
        ranLessons: persisted.ranLessons,
        savedCustomSchema: persisted.customSchema ?? null,
        savedCustomDatabase: persisted.customDatabase ?? null,
        savedCustomRevision: persisted.customRevision,
        customDdlDraft: persisted.customDdlDraft ?? null,
      });
    }
    const startupSchema =
      persisted?.lastSchemaId === 'custom'
        ? persisted.customSchema
        : schemaById(persisted?.lastSchemaId ?? '') ?? PRELOADED_SCHEMAS[0];
    const savedBytes = startupSchema?.id === 'custom' ? persisted?.customDatabase : undefined;
    let result = await get().loadSchema(startupSchema ?? PRELOADED_SCHEMAS[0], savedBytes);
    // A corrupt/evicted custom snapshot must never prevent the course from opening.
    if (!result.ok && startupSchema?.id === 'custom') {
      result = await get().loadSchema(PRELOADED_SCHEMAS[0]);
    }
    if (!result.ok && !result.cancelled) set({ dbError: result.error ?? 'Unknown error' });
  },

  loadSchema: async (def, savedBytes) => {
    const generation = ++schemaLoadGeneration;
    const draftAtDispatch = get().customDdlDraft;
    queryRunGeneration++;
    set({ schemaLoading: true, playing: false });
    return serializeDatabase(async () => {
      try {
        // A superseded request that has not reached the worker can be skipped.
        if (generation !== schemaLoadGeneration) return { ok: false, cancelled: true };
        const { schema, fkEdges, tableData, databaseBytes } = await loadSchemaInWorker(def, savedBytes);
        // Once the worker has accepted a schema, adopt it even if another load
        // is queued. If that later load fails, canvas and worker must agree.

        // Someone who starts typing while SQLite is still starting keeps their
        // text: only a change of schema replaces the editor with the starter query.
        const previous = get();
        const keepTypedSql =
          !previous.dbReady && def.id === previous.schemaDef.id && previous.sql !== previous.schemaDef.starterQuery;
        set({
          dbReady: true,
          dbError: null,
          schemaDef: def,
          schemaRevision: previous.schemaRevision + 1,
          schema,
          fkEdges,
          tableData,
          sql: keepTypedSql
            ? previous.sql
            : def.starterQuery || `SELECT * FROM ${quoteIdentIfNeeded(schema[0].name)};`,
          trace: null,
          tracedSql: null,
          currentStep: 0,
          playing: false,
          finished: false,
          error: null,
          notes: [],
          selection: null,
          hoveredRow: null,
          hoveredResultRow: null,
          ...(def.id === 'custom'
            ? {
                savedCustomSchema: def, savedCustomDatabase: databaseBytes ?? null,
                // A restored checkpoint does not build the draft. A fresh build
                // consumes only the submitted draft, never later keystrokes.
                ...(!savedBytes && previous.customDdlDraft === draftAtDispatch ? { customDdlDraft: null } : {}),
              }
            : {}),
        });
        if (def.id === 'custom' && !savedBytes) await persistCustomCheckpoint(true);
        else await savePersistedAppState({ lastSchemaId: def.id });
        if (def.id === 'custom') requestDurableStorage();
        return generation === schemaLoadGeneration ? { ok: true } : { ok: false, cancelled: true };
      } catch (err) {
        if (err instanceof PersistenceConflictError) {
          await restoreAfterConflict(err, !savedBytes && def.id === 'custom' ? def.ddl : undefined);
        }
        if (generation !== schemaLoadGeneration) return { ok: false, cancelled: true };
        return {
          ok: false,
          error: err instanceof PersistenceConflictError ? get().error ?? err.message : err instanceof Error ? err.message : String(err),
          statement: err instanceof WorkerRequestError ? err.statement : undefined,
        };
      } finally {
        if (generation === schemaLoadGeneration) set({ schemaLoading: false });
      }
    });
  },

  resumeCustomSchema: async () => {
    if (get().schemaLoading) return { ok: false, error: 'Wait for the current schema to finish loading.' };
    // Reserve the user's place before either wait. A later schema choice must
    // supersede this resume, even while an earlier mutation is still saving.
    const generation = ++schemaLoadGeneration;
    queryRunGeneration++;
    set({ schemaLoading: true, playing: false });
    try {
      // Finish already accepted mutations before choosing the checkpoint to resume.
      await databaseOperations;
      if (generation !== schemaLoadGeneration) return { ok: false, cancelled: true };
      // A different tab may have saved a more recent custom checkpoint.
      const latest = await loadPersistedAppState();
      if (generation !== schemaLoadGeneration) return { ok: false, cancelled: true };
      if (latest?.customSchema) set({
        savedCustomSchema: latest.customSchema,
        savedCustomDatabase: latest.customDatabase ?? null,
        savedCustomRevision: latest.customRevision,
      });
      const state = get();
      if (!state.savedCustomSchema) return { ok: false, error: 'There is no saved custom schema to resume.' };
      // loadSchema synchronously takes ownership of loading before it queues
      // the worker request; this resume's cleanup cannot clear its indicator.
      return state.loadSchema(state.savedCustomSchema, state.savedCustomDatabase ?? undefined);
    } finally {
      if (generation === schemaLoadGeneration) set({ schemaLoading: false });
    }
  },

  setSql: (sql) => {
    queryRunGeneration++;
    set((state) =>
      state.sql === sql
        ? state
        : {
            sql,
            trace: null,
            tracedSql: null,
            currentStep: 0,
            playing: false,
            finished: false,
            error: null,
            notes: [],
            selection: null,
            hoveredRow: null,
            hoveredResultRow: null,
          }
    );
  },

  runQuery: async (sqlArg) => {
    if (get().schemaLoading) {
      set({ error: 'A schema is still loading. Wait for it to finish before running a query.', playing: false });
      return;
    }
    const generation = ++queryRunGeneration;
    const sql = sqlArg ?? get().sql;
    const schemaAtDispatch = get().schemaRevision;
    const isCustom = get().schemaDef.id === 'custom';
    if (!get().dbReady) {
      set({ error: 'SQLite is still starting. Try again in a moment.', playing: false });
      return;
    }
    if (sql.length > MAX_QUERY_CHARS) {
      set({
        error: `Queries are limited to ${MAX_QUERY_CHARS.toLocaleString()} characters.`,
        playing: false,
      });
      return;
    }
    set({ playing: false });
    return serializeDatabase(async () => {
      // A conflict recovery can replace the schema ahead of a queued query.
      if (get().schemaRevision !== schemaAtDispatch) return;
      try {
        const { trace, notes, mutation } = await runQueryInWorker(sql);
        const mutationState = mutation ? {
          tableData: mutation.tableData,
          ...(mutation.schema ? { schema: mutation.schema, fkEdges: mutation.fkEdges ?? [] } : {}),
          ...(isCustom && mutation.databaseBytes ? { savedCustomDatabase: mutation.databaseBytes } : {}),
        } : {};
        if (generation !== queryRunGeneration) {
          // Editing cancels an obsolete teaching trace, not an acknowledged
          // database write. Retain the write without replacing the new text or
          // a different schema that has already finished loading.
          if (mutation && get().schemaRevision === schemaAtDispatch) {
            set(mutationState);
            if (isCustom) await persistCustomCheckpoint();
          }
          return;
        }
        set({
          trace,
          notes,
          tracedSql: sql,
          currentStep: 0,
          playing: true,
          finished: false,
          error: null,
          selection: null,
          hoveredRow: null,
          hoveredResultRow: null,
          ...mutationState,
        });
        if (mutation && isCustom) await persistCustomCheckpoint();
      } catch (err) {
        if (err instanceof PersistenceConflictError) {
          await restoreAfterConflict(err);
          return;
        }
        if (generation !== queryRunGeneration) return;
        const msg = err instanceof Error ? err.message : `Trace failed: ${String(err)}`;
        set({ error: msg, playing: false });
      }
    });
  },

  play: () => {
    const { trace, currentStep } = get();
    if (!trace) return;
    // Restart from the top if the user hits play at the end.
    if (currentStep >= trace.length - 1) set({ currentStep: 0, playing: true, finished: false, hoveredRow: null, hoveredResultRow: null });
    else set({ playing: true, finished: false });
  },
  pause: () => set({ playing: false }),
  stepForward: () => {
    const { trace, currentStep } = get();
    if (!trace) return;
    set({ currentStep: Math.min(currentStep + 1, trace.length - 1), playing: false, finished: false, hoveredRow: null, hoveredResultRow: null });
  },
  stepBack: () => {
    const { trace, currentStep } = get();
    if (!trace) return;
    set({ currentStep: Math.max(currentStep - 1, 0), playing: false, finished: false, hoveredRow: null, hoveredResultRow: null });
  },
  reset: () => set({ currentStep: 0, playing: false, finished: false, selection: null, hoveredRow: null, hoveredResultRow: null }),
  gotoStep: (i) => {
    const { trace } = get();
    if (!trace) return;
    set({ currentStep: Math.max(0, Math.min(i, trace.length - 1)), playing: false, finished: false, hoveredRow: null, hoveredResultRow: null });
  },
  setSpeed: (s) => set({ speed: s }),
  selectRow: (sel) => {
    const cur = get().selection;
    if (sel && cur && cur.table === sel.table && cur.rid === sel.rid) {
      set({ selection: null }); // toggle off
    } else {
      set({ selection: sel });
    }
  },
  setHoveredRow: (sel) => set((state) =>
    state.hoveredRow?.table === sel?.table && state.hoveredRow?.rid === sel?.rid
      ? state : { hoveredRow: sel }
  ),
  setHoveredResultRow: (i) => set((state) =>
    state.hoveredResultRow === i ? state : { hoveredResultRow: i }
  ),
  markLessonRun: (id) => {
    set((state) => ({ ranLessons: { ...state.ranLessons, [id]: true } }));
    return savePersistedAppState({ ranLessons: { [id]: true } }).then(() => undefined);
  },
  setEditorFocused: (focused) => set({ editorFocused: focused }),
  setCustomDdlDraft: (ddl) => { customDraftDirty = true; set({ customDdlDraft: ddl }); },
  persistCustomDdlDraft: async () => {
    if (!customDraftDirty) return;
    const draft = get().customDdlDraft;
    await savePersistedAppState({ customDdlDraft: draft ?? undefined });
    if (get().customDdlDraft === draft) customDraftDirty = false;
  },
}));

/** Save one custom checkpoint only if it still descends from the durable revision. */
async function persistCustomCheckpoint(includeDraft = false): Promise<void> {
  const state = useAppStore.getState();
  const saved = await savePersistedAppState({
    lastSchemaId: 'custom',
    customSchema: state.savedCustomSchema ?? undefined,
    customDatabase: state.savedCustomDatabase ?? undefined,
    ...(includeDraft ? { customDdlDraft: state.customDdlDraft ?? undefined } : {}),
  }, state.savedCustomRevision);
  if (saved) useAppStore.setState({ savedCustomRevision: saved.customRevision });
  if (includeDraft && useAppStore.getState().customDdlDraft === state.customDdlDraft) customDraftDirty = false;
}

/** A rejected stale write must never leave its unpersisted worker state masquerading as saved. */
async function restoreAfterConflict(conflict: PersistenceConflictError, attemptedDdl?: string): Promise<void> {
  const current = conflict.current;
  const state = useAppStore.getState();
  const wasLoading = state.schemaLoading;
  useAppStore.setState({ schemaLoading: true, playing: false });
  queryRunGeneration++;
  if (attemptedDdl) customDraftDirty = true;
  try {
    if (!current.customSchema || !current.customDatabase) throw new Error('The latest saved schema has no usable checkpoint.');
    const loaded = await loadSchemaInWorker(current.customSchema, current.customDatabase);
    useAppStore.setState({
      dbReady: true, dbError: null,
      schemaDef: current.customSchema, schemaRevision: useAppStore.getState().schemaRevision + 1,
      schema: loaded.schema, fkEdges: loaded.fkEdges, tableData: loaded.tableData,
      savedCustomSchema: current.customSchema, savedCustomDatabase: current.customDatabase,
      savedCustomRevision: current.customRevision,
      customDdlDraft: useAppStore.getState().customDdlDraft ?? attemptedDdl ?? null,
      trace: null, tracedSql: null, notes: [], currentStep: 0, finished: false,
      selection: null, hoveredRow: null, hoveredResultRow: null,
      error: `${conflict.message} The latest saved data has been restored. Review it before retrying your query or build.`,
    });
  } catch {
    useAppStore.setState({ dbReady: false, dbError: 'Another tab changed the saved schema. This change was not saved. Reload to restore the latest saved data.' });
  } finally {
    useAppStore.setState({ schemaLoading: wasLoading });
  }
}

/** Current step, derived. */
export function useCurrentStep(): TraceStep | null {
  return useAppStore((s) => (s.trace ? s.trace[s.currentStep] ?? null : null));
}

/** Human label for a row: its full primary key if the table has one, else #rowid. */
export function displayRowLabel(table: string, rid: number): string {
  const { schema, tableData, trace, currentStep } = useAppStore.getState();
  const meta = schema.find((t) => t.name === table);
  // While a data change shows the "before" state, label rows from that snapshot.
  const data = ownValue(trace?.[currentStep]?.tableSnapshots, table) ?? ownValue(tableData, table);
  const pkIndices = meta
    ? meta.columns.map((column, index) => (column.pk ? index : -1)).filter((index) => index >= 0)
    : [];
  if (data && pkIndices.length > 0) {
    const rowIdx = data.rids.indexOf(rid);
    if (rowIdx >= 0) {
      return pkIndices
        .map((index) => `${meta!.columns[index].name} ${String(data.rows[rowIdx][index])}`)
        .join(' · ');
    }
  }
  return `row #${rid}`;
}

export interface Highlight {
  rows: Record<string, Set<number>>;
  resultRows: Set<number>;
  /** Pinned contributors are kept separate from transient hover previews. */
  pinnedRows: Record<string, Set<number>>;
}

type Provenance = ReturnType<typeof provenanceFor>;
let pinnedStep: TraceStep | null = null;
let pinnedSelection: Selection | null = null;
let cachedPinned: Provenance | null = null;

function selectPinnedHighlight(state: AppState): Provenance | null {
  const step = state.trace?.[state.currentStep] ?? null;
  if (step === pinnedStep && state.selection === pinnedSelection) return cachedPinned;
  pinnedStep = step;
  pinnedSelection = state.selection;
  cachedPinned = step && state.selection ? provenanceFor(step, state.selection.table, state.selection.rid) : null;
  return cachedPinned;
}

/** Stable across hover changes, also used to reveal a pin in a scroll window. */
export function usePinnedHighlight(): Provenance | null {
  return useAppStore(selectPinnedHighlight);
}

/**
 * Keep the pinned trace visible while allowing an additional hover preview.
 */
// Every table and the result panel share one derived snapshot. Per-component
// useMemo would repeat the same provenance lookup for every subscriber.
let highlightInputs: readonly unknown[] = [];
let cachedHighlight: Highlight | null = null;
function selectHighlight(state: AppState): Highlight | null {
  const step = state.trace?.[state.currentStep] ?? null;
  const { selection, hoveredRow, hoveredResultRow } = state;
  const inputs = [step, selection, hoveredRow, hoveredResultRow];
  if (inputs.every((input, i) => input === highlightInputs[i])) return cachedHighlight;
  highlightInputs = inputs;
  cachedHighlight = (() => {
    if (!step) return null;
    const pinned = selectPinnedHighlight(state);
    let preview: Provenance | null = null;
    if (hoveredResultRow !== null && step.resultRowSources?.[hoveredResultRow]) {
      const rows: Record<string, Set<number>> = emptyRecord();
      for (const [table, rids] of Object.entries(step.resultRowSources[hoveredResultRow])) {
        if (rids.length) rows[table] = new Set(rids);
      }
      preview = { rows, resultRows: new Set([hoveredResultRow]) };
    } else if (hoveredRow) {
      preview = provenanceFor(step, hoveredRow.table, hoveredRow.rid);
    }
    const base = pinned ?? preview;
    if (!base) return null;
    const rows = Object.assign(emptyRecord<Set<number>>(), base.rows);
    const resultRows = new Set(base.resultRows);
    if (pinned && preview) {
      for (const [table, rids] of Object.entries(preview.rows)) {
        rows[table] = new Set([...(rows[table] ?? []), ...rids]);
      }
      for (const index of preview.resultRows) resultRows.add(index);
    }
    return { rows, resultRows, pinnedRows: pinned?.rows ?? {} };
  })();
  return cachedHighlight;
}

export function useHighlight(): Highlight | null {
  return useAppStore(selectHighlight);
}
