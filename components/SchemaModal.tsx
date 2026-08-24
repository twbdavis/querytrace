'use client';

import { useEffect, useState } from 'react';
import { PRELOADED_SCHEMAS, type SchemaDef } from '@/lib/schemas';
import { useAppStore } from '@/store/useAppStore';
import { CheckIcon, CloseIcon, DatabaseIcon } from './Icons';

interface SchemaModalProps {
  open: boolean;
  onClose: () => void;
}

const DDL_TEMPLATE = `-- Define tables with CREATE TABLE, mark keys, then INSERT the rows.
-- Constraint syntax (slideset 4):
--   PRIMARY KEY on the identifying column
--   PRIMARY KEY (col1, col2) for a composite identifier
--   AUTO_INCREMENT is accepted for an INTEGER PRIMARY KEY
--   CONSTRAINT name FOREIGN KEY (col) REFERENCES parent (col) [ON DELETE CASCADE]

CREATE TABLE TEAM (
  TEAMNO   INTEGER PRIMARY KEY,
  TEAMNAME VARCHAR(20)
);

CREATE TABLE PLAYER (
  PLAYERNO INTEGER PRIMARY KEY,
  PNAME    VARCHAR(20),
  TEAMNO   INTEGER,
  CONSTRAINT player_team_fk FOREIGN KEY (TEAMNO) REFERENCES TEAM (TEAMNO)
);

INSERT INTO TEAM VALUES (1, 'Aggies'), (2, 'Longhorns');
INSERT INTO PLAYER VALUES (10, 'Ana', 1), (11, 'Ben', 1), (12, 'Cruz', 2);
`;

export function SchemaModal({ open, onClose }: SchemaModalProps) {
  const schemaDef = useAppStore((s) => s.schemaDef);
  const savedCustomSchema = useAppStore((s) => s.savedCustomSchema);
  const loadSchema = useAppStore((s) => s.loadSchema);
  const [ddl, setDdl] = useState('');
  const [ddlError, setDdlError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setDdl(schemaDef.id === 'custom' ? schemaDef.ddl : savedCustomSchema?.ddl ?? DDL_TEMPLATE);
      setDdlError(null);
    }
  }, [open, schemaDef, savedCustomSchema]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const pick = async (def: SchemaDef) => {
    setBusy(true);
    const res = await loadSchema(def);
    setBusy(false);
    if (res.ok) onClose();
    else setDdlError(res.error ?? 'Failed to load schema.');
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
    else setDdlError(res.error ?? 'Failed to build the schema.');
  };

  return (
    <>
      {open && (
        <div
          className="modal-backdrop-enter fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm max-sm:items-end max-sm:p-0"
          onClick={onClose}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Schema"
            className="modal-dialog-enter flex max-h-[88vh] w-full max-w-4xl flex-col rounded-md border border-line-strong bg-panel max-sm:h-[100dvh] max-sm:max-h-none max-sm:rounded-none max-sm:border-0"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3 max-sm:min-h-14 max-sm:px-3 max-sm:pt-[calc(0.75rem+env(safe-area-inset-top))]">
              <span className="inline-flex items-center gap-2 font-ui text-[12px] font-bold uppercase tracking-[0.2em] text-ink">
                <DatabaseIcon size={14} className="text-accent-active" />
                schema
              </span>
              <button
                onClick={onClose}
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

              <div className="mb-2 font-ui text-[10px] font-bold uppercase tracking-[0.25em] text-ink-mute">
                build your own
              </div>
              <p className="mb-2 text-[11px] leading-relaxed text-ink-dim">
                Define tables, attributes and key connections with CREATE TABLE, then add rows
                with INSERT INTO ... VALUES. Every relation needs a PRIMARY KEY (including a
                composite key where appropriate). Connect
                tables with CONSTRAINT ... FOREIGN KEY ... REFERENCES parent (column) - the
                canvas, key badges and FK wires are all read from your statements.
              </p>
              <textarea
                value={ddl}
                onChange={(e) => setDdl(e.target.value)}
                spellCheck={false}
                aria-label="Schema definition SQL"
                className="mb-2 h-56 w-full resize-y rounded-md border border-line bg-app p-3 font-data text-[11px] leading-relaxed text-ink focus:border-accent-active focus:outline-none max-sm:h-52 max-sm:text-base max-sm:leading-6"
              />
              {ddlError && (
                <div
                  role="alert"
                  className="mb-2 rounded border-l-2 border-accent-error/40 border-l-accent-error bg-accent-error/[0.08] px-3 py-2 font-data text-[11px] leading-relaxed text-accent-error"
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
