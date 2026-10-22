'use client';

import { useCallback, useEffect, useRef, type CSSProperties, type PointerEvent } from 'react';

interface PanelResizeHandleProps {
  label: string;
  orientation: 'vertical' | 'horizontal';
  controls: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  style?: CSSProperties;
}

/** A border that can be dragged with either mouse button or resized by keyboard. */
export function PanelResizeHandle({ label, orientation, controls, value, min, max, onChange, style }: PanelResizeHandleProps) {
  const vertical = orientation === 'vertical';
  const drag = useRef<{
    target: HTMLDivElement;
    pointerId: number;
    start: number;
    value: number;
    cursor: string;
    userSelect: string;
  } | null>(null);

  const finish = useCallback(() => {
    const active = drag.current;
    if (!active) return;
    drag.current = null;
    document.documentElement.style.cursor = active.cursor;
    document.documentElement.style.userSelect = active.userSelect;
    if (active.target.hasPointerCapture(active.pointerId)) active.target.releasePointerCapture(active.pointerId);
  }, []);

  useEffect(() => {
    window.addEventListener('blur', finish);
    return () => {
      window.removeEventListener('blur', finish);
      finish();
    };
  }, [finish]);

  const update = (next: number) => onChange(Math.max(min, Math.min(max, next)));
  const start = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.button !== 0 && event.button !== 2) || drag.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus();
    drag.current = {
      target: event.currentTarget,
      pointerId: event.pointerId,
      start: vertical ? event.clientX : event.clientY,
      value,
      cursor: document.documentElement.style.cursor,
      userSelect: document.documentElement.style.userSelect,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.documentElement.style.cursor = vertical ? 'col-resize' : 'row-resize';
    document.documentElement.style.userSelect = 'none';
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-controls={controls}
      aria-valuenow={Math.round(value)}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      aria-valuetext={`${Math.round(value)} pixels`}
      title={`${label}: drag with either mouse button, or use ${vertical ? 'Left/Right' : 'Up/Down'} arrow keys`}
      className={`group absolute z-10 touch-none select-none outline-offset-0 ${vertical ? '-right-1 top-0 h-full w-2 cursor-col-resize' : 'left-0 h-2 w-full -translate-y-1/2 cursor-row-resize'}`}
      style={style}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onPointerDown={start}
      onPointerMove={(event) => {
        const active = drag.current;
        if (!active || event.pointerId !== active.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        update(active.value + (vertical ? event.clientX : event.clientY) - active.start);
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onKeyDown={(event) => {
        const decrease = vertical ? 'ArrowLeft' : 'ArrowUp';
        const increase = vertical ? 'ArrowRight' : 'ArrowDown';
        if (![decrease, increase, 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === 'Home') update(min);
        else if (event.key === 'End') update(max);
        else update(value + (event.key === increase ? 1 : -1) * (event.shiftKey ? 40 : 20));
      }}
    >
      <span aria-hidden="true" className={`absolute bg-accent-active/0 transition-colors group-hover:bg-accent-active group-focus-visible:bg-accent-active group-active:bg-accent-active ${vertical ? 'inset-y-1 left-1/2 w-px' : 'inset-x-1 top-1/2 h-px'}`} />
      <span aria-hidden="true" className={`absolute bg-line-strong transition-colors group-hover:bg-accent-active group-focus-visible:bg-accent-active ${vertical ? 'left-1/2 top-1/2 h-8 w-0.5 -translate-x-1/2 -translate-y-1/2' : 'left-1/2 top-1/2 h-0.5 w-8 -translate-x-1/2 -translate-y-1/2'}`} />
    </div>
  );
}
