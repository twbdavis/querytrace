'use client';

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { PRELOADED_SCHEMAS, type SchemaDef } from '@/lib/schemas';
import { useAppStore } from '@/store/useAppStore';
import { CheckIcon, CloseIcon, DatabaseIcon } from './Icons';

interface SchemaModalProps {
  open: boolean;
  onClose: () => void;
}

const DDL_TEMPLATE = `-- Define tables with CREATE TABLE, mark keys, then INSERT the rows.
-- Constraint syntax:
--   PRIMARY KEY on the identifying column
--   PRIMARY KEY (col1, col2) for a composite identifier
--   AUTO_INCREMENT is accepted for an INTEGER PRIMARY KEY
--   CONSTRAINT name FOREIGN KEY (col) REFERENCES parent (col) [ON DELETE CASCADE]
-- MySQL / PostgreSQL / SQL Server exports paste in as-is: ENGINE=, CHARSET,
-- SERIAL, IDENTITY and inline KEY/INDEX lines are translated for you.

CREATE TABLE GARDEN (
  GARDEN_ID INTEGER PRIMARY KEY,
  GARDEN_NAME VARCHAR(30)
);

CREATE TABLE PLANTING (
  PLANTING_ID INTEGER PRIMARY KEY,
  CROP_NAME VARCHAR(30),
  GARDEN_ID INTEGER,
  CONSTRAINT planting_garden_fk FOREIGN KEY (GARDEN_ID) REFERENCES GARDEN (GARDEN_ID)
);

INSERT INTO GARDEN VALUES (1, 'Courtyard'), (2, 'Rooftop');
INSERT INTO PLANTING VALUES (10, 'Basil', 1), (11, 'Kale', 1), (12, 'Tomato', 2);
`;

export function SchemaModal({ open, onClose }: SchemaModalProps) {
  const schemaDef = useAppStore((s) => s.schemaDef);
  const savedCustomSchema = useAppStore((s) => s.savedCustomSchema);
  const draft = useAppStore((s) => s.customDdlDraft);
  const setCustomDdlDraft = useAppStore((s) => s.setCustomDdlDraft);
  const persistCustomDdlDraft = useAppStore((s) => s.persistCustomDdlDraft);
  const loadSchema = useAppStore((s) => s.loadSchema);
  const [ddlError, setDdlError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errorRef = useRef<HTMLDivElement | null>(null);
  // Where the current press started; a click only closes the dialog when the
  // press began on the backdrop itself. Dragging a text selection out of the
  // SQL box and releasing over the backdrop must never throw the draft away.
  const pressedBackdrop = useRef(false);

  // The editor shows, in order of preference: SQL still being edited, the
  // custom schema currently on the canvas, the last custom schema built, or
  // the starter template.
  const ddl = draft ?? (schemaDef.id === 'custom' ? schemaDef.ddl : savedCustomSchema?.ddl ?? DDL_TEMPLATE);

  useEffect(() => {
    if (open) setDdlError(null);
  }, [open]);

  useEffect(() => {
    if (ddlError) errorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [ddlError]);

  const close = () => {
    void persistCustomDdlDraft();
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // `close` reads the latest store action each render; re-binding on open is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose]);

  const pick = async (def: SchemaDef) => {
    setBusy(true);
    const res = await loadSchema(def);
    setBusy(false);
    if (res.ok) close();
    else if (!res.cancelled) setDdlError(res.error ?? 'Failed to load schema.');
  };

  const applyCustom = async () => {
    setBusy(true);
    setDdlError(null);
    const res = await loadSchema({
      id: 'custom',
      name: 'Custom schema',
      description: 'User-defined schema',
      ddl,
      starterQuery: '',
    });
    setBusy(false);
    if (res.ok) onClose();
    else if (!res.cancelled) {
      // Keep the SQL exactly as typed so the message can be acted on in place.
      void persistCustomDdlDraft();
      setDdlError(res.error ?? 'Failed to build the schema.');
    }
  };

  const onBackdropMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    pressedBackdrop.current = e.target === e.currentTarget;
  };
  const onBackdropClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const startedOnBackdrop = pressedBackdrop.current;
    pressedBackdrop.current = false;
    if (startedOnBackdrop && e.target === e.currentTarget) close();
  };

  return (
    <>
      {open && (
        <div
          className="modal-backdrop-enter fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm max-sm:items-end max-sm:p-0"
          onMouseDown={onBackdropMouseDown}
          onClick={onBackdropClick}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Schema"
            className="modal-dialog-enter flex max-h-[88vh] w-full max-w-4xl flex-col rounded-md border border-line-strong bg-panel max-sm:h-[100dvh] max-sm:max-h-none max-sm:rounded-none max-sm:border-0"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3 max-sm:min-h-14 max-sm:px-3 max-sm:pt-[calc(0.75rem+env(safe-area-inset-top))]">
              <span className="inline-flex items-center gap-2 font-ui text-[12px] font-bold uppercase tracking-[0.2em] text-ink">
                <DatabaseIcon size={14} className="text-accent-active" />
                schema
              </span>
              <button
                onClick={close}
                aria-label="Close schema settings"
                className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-ink-dim transition-colors hover:bg-white/5 hover:text-ink max-sm:h-9 max-sm:w-9"
              >
                <CloseIcon size={13} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4 max-sm:p-3 max-sm:pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
              <div className="mb-2 font-ui text-[10px] font-bold uppercase tracking-[0.25em] text-ink-mute">
                preloaded databases
              </div>
              <div className="mb-5 grid grid-cols-1 gap-2.5 md:grid-cols-2">
                {PRELOADED_SCHEMAS.map((def) => {
                  const active = schemaDef.id === def.id;
                  return (
                    <button
                      key={def.id}
                      disabled={busy}
                      onClick={() => void pick(def)}
                      className={`flex cursor-pointer flex-col rounded-md border p-3 text-left transition-colors disabled:opacity-50 max-sm:min-h-20 max-sm:p-3.5 ${
                        active
                          ? 'border-accent-active bg-accent-active/5'
                          : 'border-line bg-node hover:border-line-strong'
                      }`}
                    >
                      <span className="mb-1 flex items-center justify-between gap-2">
                        <span className="font-ui text-[12px] font-medium text-ink">{def.name}</span>
                        {active && (
                          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent-active/20 text-accent-active">
                            <CheckIcon size={9} />
                          </span>
                        )}
                      </span>
                      <span className="text-[11px] leading-relaxed text-ink-dim">
                        {def.description}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="font-ui text-[10px] font-bold uppercase tracking-[0.25em] text-ink-mute">
                  build your own
                </span>
                {draft !== null && (
                  <button
                    type="button"
                    onClick={() => {
                      setCustomDdlDraft(null);
                      setDdlError(null);
                    }}
                    className="cursor-pointer font-ui text-[9px] font-bold tracking-[0.15em] text-ink-mute transition-colors hover:text-accent-active"
                    title="Discard the unsaved SQL and show the last built schema or the starter template"
                  >
                    DISCARD DRAFT
                  </button>
                )}
              </div>
              <p className="mb-2 text-[11px] leading-relaxed text-ink-dim">
                Define tables, attributes and key connections with CREATE TABLE, then add rows
                with INSERT INTO ... VALUES. Mark each relation&apos;s PRIMARY KEY (composite where
                appropriate) and connect tables with CONSTRAINT ... FOREIGN KEY ... REFERENCES
                parent (column): the canvas, key badges and FK wires are all read from your
                statements. Tables without a key still load and are traced by row position.
                Your SQL is kept here until it builds, even if this window is closed.
              </p>
              <textarea
                value={ddl}
                onChange={(e) => setCustomDdlDraft(e.target.value)}
                spellCheck={false}
                aria-label="Schema definition SQL"
                className="mb-2 h-72 min-h-[10rem] w-full resize-y rounded-md border border-line bg-app p-3 font-data text-[11px] leading-relaxed text-ink focus:border-accent-active focus:outline-none max-sm:h-60 max-sm:text-base max-sm:leading-6"
              />
              {ddlError && (
                <div
                  ref={errorRef}
                  role="alert"
                  className="mb-2 whitespace-pre-wrap rounded border-l-2 border-accent-error/40 border-l-accent-error bg-accent-error/[0.08] px-3 py-2 font-data text-[11px] leading-relaxed text-accent-error"
                >
                  {ddlError}
                </div>
              )}
              <button
                onClick={() => void applyCustom()}
                disabled={busy || !ddl.trim()}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-accent-active bg-accent-active/10 px-3 py-1.5 font-ui text-[11px] font-bold tracking-wider text-accent-active transition-colors hover:bg-accent-active/20 disabled:opacity-40 max-sm:min-h-11 max-sm:w-full max-sm:justify-center"
              >
                {busy ? 'BUILDING…' : 'BUILD THIS SCHEMA'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
