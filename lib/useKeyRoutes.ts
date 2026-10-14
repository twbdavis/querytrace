'use client';

import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import { useStoreApi, type ReactFlowState } from '@xyflow/react';
import { routeKeyConnections, type KeyConnection, type KeyRoute, type TableBounds } from './keyRoutes';

type FlowStore = ReturnType<typeof useStoreApi>;
const emptyRoutes: ReadonlyMap<string, KeyRoute> = new Map();
export const KeyRoutesReadyContext = createContext(true);
const emptySnapshot: RouteSnapshot = { subscribe: () => () => {}, getSnapshot: () => emptyRoutes };

/** All wires share one routing pass; pan, playback and hover preserve this map. */
function geometryFor(state: ReactFlowState) {
  // Hidden/new nodes are still in the measurement/layout pass. Routing that
  // inconsistent geometry can trigger expensive fallbacks before it settles.
  if (state.nodes.some((node) => !node.measured?.width || !node.measured?.height || node.style?.opacity === 0)) return;
  const bounds: TableBounds[] = state.nodes.map((node) => {
    const internal = state.nodeLookup.get(node.id);
    const position = internal?.internals.positionAbsolute ?? node.position;
    return {
      id: node.id, x: position.x, y: position.y,
      width: node.measured?.width ?? 0, height: node.measured?.height ?? 0,
    };
  });
  const connections: KeyConnection[] = [];
  for (const edge of state.edges) {
    if (edge.type !== 'fk') continue;
    const source = state.nodeLookup.get(edge.source);
    const target = state.nodeLookup.get(edge.target);
    const sourceHandle = source?.internals.handleBounds?.source?.find((handle) => handle.id === edge.sourceHandle);
    const targetHandle = target?.internals.handleBounds?.target?.find((handle) => handle.id === edge.targetHandle);
    if (!source || !target || !sourceHandle || !targetHandle) continue;
    connections.push({
      id: edge.id, source: edge.source, target: edge.target,
      sourceX: source.internals.positionAbsolute.x + sourceHandle.x + sourceHandle.width / 2,
      targetX: target.internals.positionAbsolute.x + targetHandle.x + targetHandle.width / 2,
      lane: typeof edge.data?.lane === 'number' ? edge.data.lane : 0,
    });
  }
  return { bounds, connections, fingerprint: JSON.stringify([bounds, connections]) };
}

interface RouteSnapshot {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ReadonlyMap<string, KeyRoute>;
}
// useStoreApi returns a per-hook wrapper; its getState function identifies the
// underlying shared Zustand store across every edge in this canvas.
const snapshots = new WeakMap<FlowStore['getState'], RouteSnapshot>();

export function keyRouteSnapshotFor(store: FlowStore): RouteSnapshot {
  const existing = snapshots.get(store.getState);
  if (existing) return existing;
  let routes = emptyRoutes;
  let fingerprint = '';
  let dimensions = '';
  let frame = 0;
  let unsubscribe: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const geometry = geometryFor(store.getState());
      if (!geometry) return;
      const nextDimensions = JSON.stringify(geometry.bounds.map((node) => [node.id, node.width, node.height]));
      if (nextDimensions !== dimensions) {
        // CanvasSync separates freshly resized cards in its layout pass.
        // Let that update settle before routing; position-only dragging still
        // publishes on every frame once the measured sizes are unchanged.
        dimensions = nextDimensions;
        schedule();
        return;
      }
      if (geometry.fingerprint === fingerprint) return;
      fingerprint = geometry.fingerprint;
      routes = routeKeyConnections(geometry.connections, geometry.bounds);
      for (const listener of listeners) listener();
    });
  };
  const snapshot: RouteSnapshot = {
    getSnapshot: () => routes,
    subscribe: (listener) => {
      listeners.add(listener);
      if (!unsubscribe) unsubscribe = store.subscribe(schedule);
      schedule();
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          unsubscribe?.(); unsubscribe = undefined;
          cancelAnimationFrame(frame); frame = 0;
          routes = emptyRoutes; fingerprint = ''; dimensions = '';
        }
      };
    },
  };
  snapshots.set(store.getState, snapshot);
  return snapshot;
}

/** Measurements and layout changes publish one shared routing pass per frame. */
export function useKeyRoutes(): ReadonlyMap<string, KeyRoute> {
  const store = useStoreApi();
  const ready = useContext(KeyRoutesReadyContext);
  const snapshot = useMemo(() => keyRouteSnapshotFor(store), [store]);
  const activeSnapshot = ready ? snapshot : emptySnapshot;
  return useSyncExternalStore(activeSnapshot.subscribe, activeSnapshot.getSnapshot, () => emptyRoutes);
}
