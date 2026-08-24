/**
 * Blueprint theme — single source of truth for every color in the app.
 * The same values are mirrored as CSS variables in app/globals.css (:root),
 * and tailwind.config.ts imports these constants to generate the utility
 * palette, so components never carry raw hex.
 */

/** Surfaces: indigo drafting paper — canvas darkest so nodes float above it. */
export const surfaces = {
  app: '#090d18', // page chrome background
  canvas: '#0c1122', // React Flow canvas
  node: '#171e38', // table node body
  nodeHeader: '#26305a', // table node header bar — clearly caps each table
  panel: '#10152b', // side panels, editor bg, playback pill
  rowAlt: 'rgba(255, 255, 255, 0.03)', // zebra striping: alpha overlay, barely there
} as const;

/** Chalk-line edges. */
export const lines = {
  default: '#333f6b',
  strong: '#4a5890',
} as const;

/** Chalk text — near-white primary with only a faint indigo cast. */
export const text = {
  primary: '#eef2ff',
  secondary: '#a5b1d8',
  muted: '#626e9d',
} as const;

/** Role accents. */
export const accents = {
  active: '#8b98ff', // periwinkle: active tables, join keys, edges, current stage
  pulse: '#c7d2fe', // brighter periwinkle: traveling edge pulses, flashes
  filter: '#fcd34d', // gold: WHERE columns, null-extended rows
  group: '#f0abfc', // orchid: GROUP BY column highlight
  result: '#5eead4', // mint: projection columns, result rows, inspect mode
  error: '#fb7185', // rose: errors
} as const;

/** Pre-mixed row-state tints (never computed at runtime). */
export const rowStates = {
  litBg: 'rgba(139, 152, 255, 0.20)',
  litBorder: accents.active,
  nullBorder: accents.filter, // rendered dashed
  inspectBg: 'rgba(94, 234, 212, 0.20)',
} as const;

/** Drafting-paper grid lines: just perceptible, never louder than idle edges. */
export const grid = {
  minor: '#161d38',
  major: '#1d2547',
} as const;

/** GROUP BY bucket cycle — orchid-led blueprint palette. */
export const GROUP_PALETTE = [
  '#8b98ff',
  '#f0abfc',
  '#fcd34d',
  '#5eead4',
  '#fca5a5',
  '#7dd3fc',
  '#c4b5fd',
  '#fdba74',
];
