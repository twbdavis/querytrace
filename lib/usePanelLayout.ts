'use client';

import { useEffect, useState } from 'react';

const MIN_WIDTH = 304;
// Leave room for the canvas and the playback controls beside the floating panels.
const CANVAS_RESERVE = 460;
const PANEL_GAP = 8;
const STORAGE_KEY = 'querytrace.panel-layout.v1';

export function usePanelLayout() {
  const [column, setColumn] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [queryShare, setQueryShare] = useState<number | null>(null);
  const [queryOpen, setQueryOpen] = useState(true);
  const [resultsOpen, setResultsOpen] = useState(true);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [bounds, setBounds] = useState({ width: MIN_WIDTH, height: 600, left: 8, maxWidth: MIN_WIDTH });

  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
      if (saved && typeof saved === 'object') {
        const preferences = saved as { width?: unknown; queryShare?: unknown; queryOpen?: unknown; resultsOpen?: unknown };
        if (typeof preferences.width === 'number' && Number.isFinite(preferences.width) && preferences.width >= MIN_WIDTH) {
          setWidth(preferences.width);
        }
        if (typeof preferences.queryShare === 'number' && Number.isFinite(preferences.queryShare)
          && preferences.queryShare > 0 && preferences.queryShare < 1) {
          setQueryShare(preferences.queryShare);
        }
        if (typeof preferences.queryOpen === 'boolean') setQueryOpen(preferences.queryOpen);
        if (typeof preferences.resultsOpen === 'boolean') setResultsOpen(preferences.resultsOpen);
      }
    } catch {
      // Invalid or unavailable storage leaves the panels usable with their defaults.
    }
    setPreferencesLoaded(true);
  }, []);

  useEffect(() => {
    // Wait for restoration so the initial defaults cannot replace a saved layout.
    if (!preferencesLoaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ width, queryShare, queryOpen, resultsOpen }));
    } catch {
      // Panel controls still work when browser storage is blocked or full.
    }
  }, [width, queryShare, queryOpen, resultsOpen, preferencesLoaded]);

  useEffect(() => {
    const workspace = column?.parentElement;
    if (!column || !workspace) return;
    const measure = () => {
      const next = {
        width: column.offsetWidth,
        height: column.clientHeight,
        left: column.offsetLeft,
        maxWidth: Math.max(MIN_WIDTH, workspace.clientWidth - CANVAS_RESERVE),
      };
      setBounds((previous) => Object.keys(next).every((key) => previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(workspace);
    observer.observe(column);
    return () => observer.disconnect();
  }, [column]);

  const availableHeight = Math.max(0, bounds.height - PANEL_GAP);
  const minQueryHeight = Math.min(200, availableHeight / 2);
  const maxQueryHeight = Math.max(minQueryHeight, availableHeight - Math.min(160, availableHeight / 2));
  const queryHeight = Math.max(minQueryHeight, Math.min(maxQueryHeight,
    queryShare === null ? Math.min(bounds.height * 0.42, 420) : availableHeight * queryShare));

  return {
    queryOpen,
    setQueryOpen,
    resultsOpen,
    setResultsOpen,
    columnRef: setColumn,
    columnStyle: { width: width ?? undefined, minWidth: MIN_WIDTH, maxWidth: `calc(100% - ${CANVAS_RESERVE}px)` },
    width: bounds.width,
    minWidth: MIN_WIDTH,
    maxWidth: bounds.maxWidth,
    setWidth,
    leftInset: bounds.left + bounds.width + PANEL_GAP,
    queryHeight,
    minQueryHeight,
    maxQueryHeight,
    setQueryHeight: (height: number) => setQueryShare(availableHeight > 0 ? height / availableHeight : 0.5),
  };
}
