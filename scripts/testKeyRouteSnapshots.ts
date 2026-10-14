import assert from 'node:assert/strict';
import { keyRouteSnapshotFor } from '../lib/useKeyRoutes';

type Store = Parameters<typeof keyRouteSnapshotFor>[0];
const source = { id: 'P', position: { x: 0, y: 0 }, measured: { width: 100, height: 100 } };
const target = { id: 'C', position: { x: 250, y: 250 }, measured: { width: 100, height: 100 } };
const state = {
  nodes: [source, target],
  edges: [{ id: 'P.id-C.parent_id', source: 'P', target: 'C', sourceHandle: 'id', targetHandle: 'parent_id', type: 'fk' }],
  nodeLookup: new Map([
    ['P', { ...source, internals: { positionAbsolute: source.position, handleBounds: { source: [{ id: 'id', x: 29.5, width: 1 }] } } }],
    ['C', { ...target, internals: { positionAbsolute: target.position, handleBounds: { target: [{ id: 'parent_id', x: 29.5, width: 1 }] } } }],
  ]),
};
let stateReads = 0;
let subscriptions = 0;
let unsubscriptions = 0;
const storeListeners = new Set<() => void>();
const getState = () => { stateReads++; return state as unknown as ReturnType<Store['getState']>; };
const subscribe = ((listener: () => void) => {
  subscriptions++; storeListeners.add(listener);
  return () => { unsubscriptions++; storeListeners.delete(listener); };
}) as Store['subscribe'];
const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
const originalRequest = globalThis.requestAnimationFrame;
const originalCancel = globalThis.cancelAnimationFrame;
globalThis.requestAnimationFrame = (callback) => { frames.set(++frameId, callback); return frameId; };
globalThis.cancelAnimationFrame = (id) => { frames.delete(id); };
const flush = () => {
  const pending = [...frames.values()]; frames.clear();
  for (const callback of pending) callback(0);
};

try {
  // React Flow returns one wrapper per hook but shares these method functions.
  const snapshots = Array.from({ length: 437 }, () => keyRouteSnapshotFor({ getState, subscribe, setState: () => {} } as Store));
  for (const snapshot of snapshots) assert.equal(snapshot, snapshots[0], 'all per-edge store wrappers share one graph snapshot');
  let notifications = 0;
  const stops = snapshots.map((snapshot) => snapshot.subscribe(() => { notifications++; }));
  assert.equal(subscriptions, 1, '437 edges create one Zustand subscription');
  assert.equal(frames.size, 1, '437 subscribers queue one frame');
  flush();
  assert.equal(notifications, 0, 'new measured dimensions settle before routing');
  assert.equal(frames.size, 1);
  flush();
  assert.equal(stateReads, 2, 'one dimension pass and one routing pass read the entire graph');
  assert.equal(notifications, 437, 'one routing result publishes exactly once to each edge');
  assert.equal(snapshots[0].getSnapshot().size, 1);
  assert(snapshots[0].getSnapshot().get('P.id-C.parent_id')!.path);
  const routes = snapshots[0].getSnapshot();
  for (let i = 0; i < 20; i++) for (const listener of storeListeners) listener();
  assert.equal(frames.size, 1, 'rapid unrelated store updates coalesce');
  flush();
  assert.equal(notifications, 437, 'unchanged geometry does not publish/recompute routes');
  assert.equal(snapshots[0].getSnapshot(), routes);
  const separateStore = keyRouteSnapshotFor({ getState: () => getState(), subscribe, setState: () => {} } as Store);
  assert.notEqual(separateStore, snapshots[0], 'separate canvases have independent snapshots');
  for (const stop of stops) stop();
  assert.equal(unsubscriptions, 1);
  assert.equal(storeListeners.size, 0);
  assert.equal(frames.size, 0);
  assert.equal(snapshots[0].getSnapshot().size, 0, 'last-edge teardown clears old routes');
  console.log('Shared key route snapshots: 437 wrappers, one routing pass, coalescing and teardown passed.');
} finally {
  globalThis.requestAnimationFrame = originalRequest;
  globalThis.cancelAnimationFrame = originalCancel;
}
