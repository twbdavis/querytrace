'use client';

import { useMemo } from 'react';
import { create } from 'zustand';
import type { TableData } from '@/lib/db';
import {
  loadPersistedAppState,
  requestDurableStorage,
  savePersistedAppState,
} from '@/lib/persistence';
import { provenanceFor } from '@/lib/provenance';
import { quoteIdentIfNeeded } from '@/lib/sqlText';
import type { TraceStep } from '@/lib/traceEngine';
import { PRELOADED_SCHEMAS, schemaById, type FkEdgeDef, type SchemaDef, type TableMeta } from '@/lib/schemas';
import { loadSchemaInWorker, runQueryInWorker } from '@/lib/sqlWorkerClient';

const MAX_QUERY_CHARS = 20_000;
let schemaLoadGeneration = 0;
let queryRunGeneration = 0;

export type Speed = 0.5 | 1 | 2;

export interface Selection {
  table: string;
  /** SQLite rowid of the selected row. */
  rid: number;
}

export interface LoadResult {
  ok: boolean;
  error?: string;
  cancelled?: boolean;
}

interface AppState {
  dbReady: boolean;
  dbError: string | null;

  schemaDef: SchemaDef;
  savedCustomSchema: SchemaDef | null;
  savedCustomDatabase: Uint8Array | null;
  /** Schema SQL being edited in the builder; survives closing the dialog and reloads. */
  customDdlDraft: string | null;
  schema: TableMeta[];
  fkEdges: FkEdgeDef[];
  tableData: Record<string, TableData>;

  sql: string;
  error: string | null;

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
  dbError: null,

  schemaDef: PRELOADED_SCHEMAS[0],
  savedCustomSchema: null,
  savedCustomDatabase: null,
  customDdlDraft: null,
  schema: [],
  fkEdges: [],
  tableData: {},

  sql: PRELOADED_SCHEMAS[0].starterQuery,
  error: null,

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
    if (get().dbReady) return;
    const persisted = await loadPersistedAppState();
    if (persisted) {
      set({
        ranLessons: persisted.ranLessons,
        savedCustomSchema: persisted.customSchema ?? null,
        savedCustomDatabase: persisted.customDatabase ?? null,
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
    queryRunGeneration++;
    try {
      const { schema, fkEdges, tableData, databaseBytes } = await loadSchemaInWorker(def, savedBytes);

      // A user can choose a schema while the initial WASM database is still
      // loading. Never let that older startup request overwrite the choice.
      if (generation !== schemaLoadGeneration) {
        return { ok: false, cancelled: true };
      }

      // Someone who starts typing while SQLite is still starting keeps their
      // text: only a change of schema replaces the editor with the starter query.
      const previous = get();
      const keepTypedSql =
        !previous.dbReady && def.id === previous.schemaDef.id && previous.sql !== previous.schemaDef.starterQuery;
      set({
        dbReady: true,
        dbError: null,
        schemaDef: def,
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
        selection: null,
        hoveredRow: null,
        hoveredResultRow: null,
        ...(def.id === 'custom'
          ? // A successful build is the new saved schema; the draft has served its purpose.
            { savedCustomSchema: def, savedCustomDatabase: databaseBytes ?? null, customDdlDraft: null }
          : {}),
      });
      const state = get();
      await savePersistedAppState({
        lastSchemaId: def.id,
        customSchema: state.savedCustomSchema ?? undefined,
        customDatabase: state.savedCustomDatabase ?? undefined,
        customDdlDraft: state.customDdlDraft ?? undefined,
        ranLessons: state.ranLessons,
      });
      if (def.id === 'custom') requestDurableStorage();
      return { ok: true };
    } catch (err) {
      if (generation !== schemaLoadGeneration) return { ok: false, cancelled: true };
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
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
            selection: null,
            hoveredRow: null,
            hoveredResultRow: null,
          }
    );
  },

  runQuery: async (sqlArg) => {
    const generation = ++queryRunGeneration;
    const sql = sqlArg ?? get().sql;
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
    try {
      const trace = await runQueryInWorker(sql);
      if (generation !== queryRunGeneration) return;
      set({
        trace,
        tracedSql: sql,
        currentStep: 0,
        playing: true,
        finished: false,
        error: null,
        selection: null,
        hoveredRow: null,
        hoveredResultRow: null,
      });
    } catch (err) {
      if (generation !== queryRunGeneration) return;
      const msg = err instanceof Error ? err.message : `Trace failed: ${String(err)}`;
      set({ error: msg, playing: false });
    }
  },

  play: () => {
    const { trace, currentStep } = get();
    if (!trace) return;
    // Restart from the top if the user hits play at the end.
    if (currentStep >= trace.length - 1) set({ currentStep: 0, playing: true, finished: false });
    else set({ playing: true, finished: false });
  },
  pause: () => set({ playing: false }),
  stepForward: () => {
    const { trace, currentStep } = get();
    if (!trace) return;
    set({ currentStep: Math.min(currentStep + 1, trace.length - 1), playing: false, finished: false });
  },
  stepBack: () => {
    const { trace, currentStep } = get();
    if (!trace) return;
    set({ currentStep: Math.max(currentStep - 1, 0), playing: false, finished: false });
  },
  reset: () => set({ currentStep: 0, playing: false, finished: false, selection: null }),
  gotoStep: (i) => {
    const { trace } = get();
    if (!trace) return;
    set({ currentStep: Math.max(0, Math.min(i, trace.length - 1)), playing: false, finished: false });
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
  setHoveredRow: (sel) => set({ hoveredRow: sel }),
  setHoveredResultRow: (i) => set({ hoveredResultRow: i }),
  markLessonRun: (id) => {
    set((state) => ({ ranLessons: { ...state.ranLessons, [id]: true } }));
    return persistCurrentState();
  },
  setEditorFocused: (focused) => set({ editorFocused: focused }),
  setCustomDdlDraft: (ddl) => set({ customDdlDraft: ddl }),
  persistCustomDdlDraft: () => persistCurrentState(),
}));

/** Snapshot everything durable (schema choice, custom DB, draft, progress) into IndexedDB. */
function persistCurrentState(): Promise<void> {
  const state = useAppStore.getState();
  if (!state.dbReady) return Promise.resolve();
  return savePersistedAppState({
    lastSchemaId: state.schemaDef.id,
    customSchema: state.savedCustomSchema ?? undefined,
    customDatabase: state.savedCustomDatabase ?? undefined,
    customDdlDraft: state.customDdlDraft ?? undefined,
    ranLessons: state.ranLessons,
  });
}

/** Current step, derived. */
export function useCurrentStep(): TraceStep | null {
  return useAppStore((s) => (s.trace ? s.trace[s.currentStep] ?? null : null));
}

/** Human label for a row: its full primary key if the table has one, else #rowid. */
export function displayRowLabel(table: string, rid: number): string {
  const { schema, tableData } = useAppStore.getState();
  const meta = schema.find((t) => t.name === table);
  const data = tableData[table];
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
  /** True when the highlight comes from a pinned click, not a transient hover. */
  pinned: boolean;
}

/**
 * The active provenance highlight, resolved with hover taking precedence
 * over a pinned selection so the user can always "probe" freely.
 */
export function useHighlight(): Highlight | null {
  const step = useCurrentStep();
  const selection = useAppStore((s) => s.selection);
  const hoveredRow = useAppStore((s) => s.hoveredRow);
  const hoveredResultRow = useAppStore((s) => s.hoveredResultRow);

  return useMemo(() => {
    if (!step) return null;
    if (hoveredResultRow !== null && step.resultRowSources?.[hoveredResultRow]) {
      const rows: Record<string, Set<number>> = {};
      for (const [table, rids] of Object.entries(step.resultRowSources[hoveredResultRow])) {
        if (rids.length) rows[table] = new Set(rids);
      }
      return { rows, resultRows: new Set([hoveredResultRow]), pinned: false };
    }
    const sel = hoveredRow ?? selection;
    if (!sel) return null;
    const p = provenanceFor(step, sel.table, sel.rid);
    return { rows: p.rows, resultRows: p.resultRows, pinned: !hoveredRow && !!selection };
  }, [step, selection, hoveredRow, hoveredResultRow]);
}
