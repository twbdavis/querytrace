'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import s from './landing.module.css';

const PAGES = [
  { href: '/', label: 'Home' },
  { href: '/trace', label: 'Tracer' },
];

/**
 * The page menu behind the header icon: a disclosure that lists the site's
 * pages, closes on Escape, on a click elsewhere, and after a choice.
 */
export function PageMenu() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const pathname = usePathname();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  return (
    <div
      className={s.menu}
      ref={root}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        className={s.menuButton}
        ref={toggle}
        aria-label="Page menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
          <path d="M12 16h40M12 32h24M12 48h40" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="square" />
          <rect x="42" y="27" width="10" height="10" fill="#5eead4" />
        </svg>
      </button>
      {open && (
        <nav id={panelId} className={s.menuPanel} aria-label="Pages">
          {PAGES.map((page) => (
            <Link
              key={page.href}
              href={page.href}
              className={s.menuLink}
              aria-current={pathname === page.href ? 'page' : undefined}
              onClick={() => {
                setOpen(false);
                if (page.href === pathname) toggle.current?.focus();
              }}
            >
              {page.label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
