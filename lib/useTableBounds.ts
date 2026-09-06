'use client';

import { useStore, type ReactFlowState } from '@xyflow/react';
import type { TableBounds } from './keyRoutes';

let previousNodes: ReactFlowState['nodes'] | undefined;
let previousBounds: TableBounds[] = [];

// Share one geometry snapshot across all wires. Panning, playback and hover do
// not rebuild the routes; moving or resizing a table does.
function selectBounds(state: ReactFlowState): TableBounds[] {
  if (state.nodes === previousNodes) return previousBounds;
  previousNodes = state.nodes;
  const bounds = state.nodes.map((node) => {
    const internal = state.nodeLookup.get(node.id);
    const position = internal?.internals.positionAbsolute ?? node.position;
    return {
      id: node.id, x: position.x, y: position.y,
      width: node.measured?.width ?? 0,
      height: node.measured?.height ?? 0,
    };
  });
  if (bounds.length !== previousBounds.length || bounds.some((box, i) => {
    const previous = previousBounds[i];
    return box.id !== previous.id || box.x !== previous.x || box.y !== previous.y ||
      box.width !== previous.width || box.height !== previous.height;
  })) previousBounds = bounds;
  return previousBounds;
}

export function useTableBounds(): TableBounds[] {
  return useStore(selectBounds);
}
