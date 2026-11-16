'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { dialectProfile, SOURCE_DIALECTS, type SourceDialect } from '@/lib/queryCompatibility';
import { ChevronDownIcon } from './Icons';

/** One line per profile: the rules that change when it is chosen. */
const HINTS: Record<SourceDialect, string> = {
  legacy: 'Every spelling accepted; SQLite meaning where databases differ',
  sqlite: 'Plain SQLite rules, [bracketed] names allowed',
  mysql: 'Backslash escapes, # comments, backtick names',
  mariadb: 'Same reading rules as MySQL',
  postgresql: 'Standard strings, || joins text, "quoted" names',
  sqlserver: '[bracketed] names, + joins strings, TOP n',
  oracle: 'Standard strings, || joins text, ROWNUM',
};

/** Dot colour per profile, so the active mode is recognisable at a glance even where the label is short. */
const DIALECT_COLORS: Record<SourceDialect, string> = {
  legacy: '#a5b1d8',
  sqlite: '#7dd3fc',
  mysql: '#f59e0b',
  mariadb: '#a3e635',
  postgresql: '#60a5fa',
  sqlserver: '#f87171',
  oracle: '#e879f9',
};

/** Label on phone widths, where the full name does not fit. */
const SHORT_LABELS: Record<SourceDialect, string> = {
  legacy: 'ANY SQL',
  sqlite: 'SQLITE',
  mysql: 'MYSQL',
  mariadb: 'MARIADB',
  postgresql: 'POSTGRES',
  sqlserver: 'SQL SERVER',
  oracle: 'ORACLE',
};

interface DialectMenuProps {
  className: string;
}

/**
 * Top-bar control for the source dialect. The button shows the current profile
 * so a change made elsewhere (the lessons dialog) is always visible; the menu
 * lists every profile with the rules it changes.
 */
export function DialectMenu({ className }: DialectMenuProps) {
  const queryDialect = useAppStore((s) => s.queryDialect);
  const setQueryDialect = useAppStore((s) => s.setQueryDialect);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();
  const current = dialectProfile(queryDialect);
  // Any vendor profile is a deliberate mode; the default mixed reading stays quiet.
  const active = queryDialect !== 'legacy';

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    const selected = SOURCE_DIALECTS.indexOf(queryDialect);
    itemRefs.current[selected >= 0 ? selected : 0]?.focus();
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, queryDialect]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  const choose = (dialect: SourceDialect) => {
    if (dialect !== queryDialect) setQueryDialect(dialect);
    close(true);
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = itemRefs.current.filter((item): item is HTMLButtonElement => item !== null);
    const index = items.findIndex((item) => item === document.activeElement);
    const focusAt = (next: number) => items[(next + items.length) % items.length]?.focus();
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        close(true);
        break;
      case 'ArrowDown':
        event.preventDefault();
        focusAt(index + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusAt(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusAt(0);
        break;
      case 'End':
        event.preventDefault();
        focusAt(items.length - 1);
        break;
      case 'Tab':
        // Return focus to the button first, so the Tab moves on from there instead of from a removed element.
        close(true);
        break;
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Mode ${current.label}: query dialect`}
        title={`Query mode: ${current.label}. How the query text is read before it runs on SQLite.`}
        className={`${className} ${
          active
            ? 'border-accent-active bg-accent-active/10 text-accent-active hover:bg-accent-active/20'
            : 'border-line-strong text-ink hover:border-accent-active hover:text-accent-active'
        }`}
      >
        <span
          aria-hidden="true"
          className="h-2 w-2 shrink-0"
          style={{ backgroundColor: DIALECT_COLORS[queryDialect], borderRadius: '9999px', boxShadow: '0 0 0 2px rgba(0, 0, 0, 0.3)' }}
        />
        <span className="hidden sm:inline">
          <span className="text-ink-mute">MODE</span> {current.label.toUpperCase()}
        </span>
        <span className="sm:hidden">{SHORT_LABELS[queryDialect]}</span>
        <ChevronDownIcon size={10} className="hidden sm:inline" />
      </button>
      {open && (
        <div
          // Anchored to the button on wide screens; on a phone the button sits far
          // enough left that a right-anchored panel would be clipped, so it spans the screen.
          className="panel-enter absolute right-0 top-full z-50 mt-1.5 w-72 overflow-hidden rounded-md border border-line-strong bg-panel shadow-xl shadow-black/40 max-sm:fixed max-sm:inset-x-2 max-sm:top-[3.25rem] max-sm:mt-0 max-sm:w-auto"
        >
          <p id={`${menuId}-title`} className="border-b border-line px-3 py-1.5 font-ui text-[9px] font-bold uppercase tracking-[0.18em] text-ink-mute">
            Read the query as
          </p>
          <div id={menuId} role="menu" aria-labelledby={`${menuId}-title`} aria-describedby={`${menuId}-note`} onKeyDown={onMenuKeyDown}>
          {SOURCE_DIALECTS.map((dialect, index) => {
            const profile = dialectProfile(dialect);
            const selected = dialect === queryDialect;
            return (
              <button
                key={dialect}
                ref={(element) => {
                  itemRefs.current[index] = element;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => choose(dialect)}
                className={`flex w-full cursor-pointer flex-col items-start gap-0.5 px-3 py-1.5 text-left transition-colors hover:bg-white/5 focus-visible:bg-white/5 focus-visible:outline-none ${
                  selected ? 'text-accent-active' : 'text-ink'
                }`}
              >
                <span className="flex w-full items-center justify-between font-ui text-[11px] font-bold tracking-wider">
                  <span className="flex items-center gap-2">
                    <span aria-hidden="true" className="h-2 w-2" style={{ backgroundColor: DIALECT_COLORS[dialect], borderRadius: '9999px' }} />
                    {profile.label}
                  </span>
                  {selected && <span className="font-data text-[9px] tracking-widest text-accent-active">ACTIVE</span>}
                </span>
                <span className="font-ui text-[10px] text-ink-mute">{HINTS[dialect]}</span>
              </button>
            );
          })}
          </div>
          <p id={`${menuId}-note`} className="border-t border-line px-3 py-1.5 font-ui text-[10px] text-ink-mute">
            Changing it clears the current trace. The database underneath stays SQLite.
          </p>
        </div>
      )}
    </div>
  );
}
