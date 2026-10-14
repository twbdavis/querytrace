'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useStoreApi } from '@xyflow/react';

/** Refresh key handles without inserting imported table names into a CSS selector. */
export function useSafeUpdateNodeInternals() {
  const store = useStoreApi();
  const frames = useRef(new Set<number>());
  useEffect(() => () => {
    for (const frame of frames.current) cancelAnimationFrame(frame);
    frames.current.clear();
  }, []);

  return useCallback((ids: string | string[]) => {
    const wanted = new Set(Array.isArray(ids) ? ids : [ids]);
    const { domNode } = store.getState();
    if (!domNode) return;
    const updates = new Map<string, { id: string; nodeElement: HTMLDivElement; force: boolean }>();
    // The canvas holds at most 24 tables. Exact attribute comparison handles
    // quotes, brackets and backslashes while preserving the original node IDs.
    for (const nodeElement of domNode.querySelectorAll<HTMLDivElement>('.react-flow__node')) {
      const id = nodeElement.dataset.id;
      if (id !== undefined && wanted.has(id)) updates.set(id, { id, nodeElement, force: true });
    }
    if (!updates.size) return;
    const frame = requestAnimationFrame(() => {
      frames.current.delete(frame);
      store.getState().updateNodeInternals(updates, { triggerFitView: false });
    });
    frames.current.add(frame);
  }, [store]);
}
