'use client';

import { useEffect, useRef } from 'react';
import { minimalSetup } from 'codemirror';
import { autocompletion } from '@codemirror/autocomplete';
import { bracketMatching, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { SQLite, sql as sqlLanguage } from '@codemirror/lang-sql';
import { Compartment, EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { useAppStore, useCurrentStep } from '@/store/useAppStore';
import { accents, lines, surfaces, text } from '@/styles/theme';

const setClauseHighlight = StateEffect.define<{ from: number; to: number } | null>();
const clauseHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(highlights, transaction) {
    let next = highlights.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setClauseHighlight)) continue;
      next = effect.value
        ? Decoration.set([
            Decoration.mark({ class: 'queryExecHighlight' }).range(effect.value.from, effect.value.to),
          ])
        : Decoration.none;
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const blueprintHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: accents.active, fontWeight: '700' },
  { tag: [tags.string, tags.special(tags.string)], color: accents.result },
  { tag: tags.number, color: accents.group },
  { tag: tags.comment, color: text.muted, fontStyle: 'italic' },
  { tag: [tags.operator, tags.punctuation], color: text.secondary },
  { tag: [tags.name, tags.propertyName], color: text.primary },
]);

const blueprintTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      backgroundColor: surfaces.panel,
      color: text.primary,
      fontSize: '13px',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      overflow: 'auto',
      fontFamily: 'var(--font-data), Space Mono, monospace',
      lineHeight: '19px',
    },
    '.cm-content': { minHeight: '100%', padding: '10px 0 0', caretColor: accents.active },
    '.cm-line': { padding: '0 12px' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: accents.active },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: `${accents.active}33 !important`,
    },
    '.cm-activeLine': { backgroundColor: `${surfaces.nodeHeader}33` },
    '.cm-tooltip': {
      backgroundColor: surfaces.nodeHeader,
      border: `1px solid ${lines.default}`,
      color: text.primary,
      fontFamily: 'var(--font-data), Space Mono, monospace',
      fontSize: '11px',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: `${accents.active}22`,
      color: text.primary,
    },
  },
  { dark: true }
);

function schemaExtension(schema: ReturnType<typeof useAppStore.getState>['schema']) {
  return sqlLanguage({
    dialect: SQLite,
    upperCaseKeywords: true,
    schema: Object.fromEntries(
      schema.map((table) => [table.name, table.columns.map((column) => column.name)])
    ),
  });
}

export function CodeMirrorInput() {
  const sql = useAppStore((s) => s.sql);
  const schema = useAppStore((s) => s.schema);
  const setSql = useAppStore((s) => s.setSql);
  const runQuery = useAppStore((s) => s.runQuery);
  const setEditorFocused = useAppStore((s) => s.setEditorFocused);
  const tracedSql = useAppStore((s) => s.tracedSql);
  const finished = useAppStore((s) => s.finished);
  const step = useCurrentStep();

  const mountRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageConfig = useRef(new Compartment());
  const setSqlRef = useRef(setSql);
  const runQueryRef = useRef(runQuery);
  setSqlRef.current = setSql;
  runQueryRef.current = runQuery;

  useEffect(() => {
    if (!mountRef.current) return;
    const view = new EditorView({
      parent: mountRef.current,
      state: EditorState.create({
        doc: useAppStore.getState().sql,
        extensions: [
          minimalSetup,
          bracketMatching(),
          autocompletion({ activateOnTyping: true }),
          EditorView.lineWrapping,
          syntaxHighlighting(blueprintHighlight),
          languageConfig.current.of(schemaExtension(useAppStore.getState().schema)),
          blueprintTheme,
          clauseHighlightField,
          EditorView.contentAttributes.of({
            'aria-label': 'SQL query editor',
            autocapitalize: 'off',
            autocomplete: 'off',
            autocorrect: 'off',
            spellcheck: 'false',
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) setSqlRef.current(update.state.doc.toString());
            if (update.focusChanged) setEditorFocused(update.view.hasFocus);
          }),
        ],
      }),
    });
    viewRef.current = view;
    const onRunShortcut = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey) || !view.hasFocus) return;
      event.preventDefault();
      void runQueryRef.current();
    };
    window.addEventListener('keydown', onRunShortcut);
    return () => {
      window.removeEventListener('keydown', onRunShortcut);
      setEditorFocused(false);
      view.destroy();
      viewRef.current = null;
    };
  }, [setEditorFocused]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === sql) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: sql } });
  }, [sql]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: languageConfig.current.reconfigure(schemaExtension(schema)) });
  }, [schema]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const range = step?.queryRange;
    const highlight =
      range && !finished && sql === tracedSql
        ? {
            from: Math.max(0, Math.min(range.start, view.state.doc.length)),
            to: Math.max(0, Math.min(range.end, view.state.doc.length)),
          }
        : null;
    view.dispatch({ effects: setClauseHighlight.of(highlight) });
  }, [step, finished, sql, tracedSql]);

  return <div ref={mountRef} className="sql-editor h-full min-h-0 overflow-hidden" />;
}
