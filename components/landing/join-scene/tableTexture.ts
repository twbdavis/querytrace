import { CanvasTexture, SRGBColorSpace } from 'three';
import { accents, lines, surfaces, text } from '@/styles/theme';
import { TABLE_ROW_HEIGHT } from '@/lib/tableRowWindow';
import type { TableSpec } from './joinData';

/**
 * Draws a table the way components/TableNode.tsx renders one (header bar,
 * column names with type tags and PK/FK pills, zebra rows) into a canvas, so
 * the 3D cards look like the tracer's own tables. A `highlight` draws the
 * given columns the way the tracer marks a stage's columns: coloured name,
 * 2px underline, tinted header cell (periwinkle at JOIN, mint at SELECT).
 */

export interface Fonts {
  /** CSS font-family list for data (Space Mono on the site). */
  data: string;
  /** CSS font-family list for UI text (Space Grotesk on the site). */
  ui: string;
}

export interface ColumnHighlight {
  columns: number[];
  color: string;
}

export interface TableLayout {
  /** Canvas size in CSS pixels (the bitmap is drawn at `SCALE` times this). */
  width: number;
  height: number;
  /** Top of the first data row, in CSS pixels. */
  bodyTop: number;
  rowHeight: number;
  rowCount: number;
  columns: Array<{ left: number; width: number; textLeft: number }>;
  keyColumn: number;
}

const SCALE = 2;
const PAD = 4; // body inset (px-1 py-0.5)
const CELL_PAD = 6; // px-1.5
const FIRST_COL_INSET = 14; // room for the row's left bar (pl-5 vs px-1.5)
const HEADER_H = 30;
const COLS_H = 24;
const BORDER = 1.5;
const NAME_FONT = 13;
const META_FONT = 10;
const COL_FONT = 11;
const TYPE_FONT = 7;
const PILL_FONT = 8;
const CELL_FONT = 11;

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

interface ColumnMetrics {
  nameW: number;
  typeW: number;
  pillW: number;
  headerW: number;
  cellW: number;
}

function measure(ctx: CanvasRenderingContext2D, spec: TableSpec, fonts: Fonts): ColumnMetrics[] {
  return spec.columns.map((c, ci) => {
    ctx.font = `700 ${COL_FONT}px ${fonts.data}`;
    const nameW = ctx.measureText(c.name).width;
    ctx.font = `400 ${TYPE_FONT}px ${fonts.data}`;
    const typeW = c.type ? ctx.measureText(c.type.toUpperCase()).width : 0;
    ctx.font = `700 ${PILL_FONT}px ${fonts.data}`;
    const pillW = c.pk || c.fk ? ctx.measureText('PK').width + 8 : 0;
    const gaps = 4 * ((typeW ? 1 : 0) + (pillW ? 1 : 0));
    const headerW = nameW + typeW + pillW + gaps;
    ctx.font = `400 ${CELL_FONT}px ${fonts.data}`;
    let cellW = 0;
    for (const row of spec.rows) cellW = Math.max(cellW, ctx.measureText(String(row[ci])).width);
    return { nameW, typeW, pillW, headerW, cellW };
  });
}

export function layoutTable(spec: TableSpec, fonts: Fonts): TableLayout {
  const probe = document.createElement('canvas').getContext('2d');
  if (!probe) throw new Error('2D canvas unavailable');
  const metrics = measure(probe, spec, fonts);
  const columns: TableLayout['columns'] = [];
  let x = BORDER + PAD;
  metrics.forEach((m, ci) => {
    const inset = ci === 0 ? FIRST_COL_INSET : 0;
    const width = Math.ceil(Math.max(m.headerW, m.cellW) + CELL_PAD * 2 + inset);
    columns.push({ left: x, width, textLeft: x + CELL_PAD + inset });
    x += width;
  });
  const width = Math.ceil(x + PAD + BORDER);
  const bodyTop = BORDER + HEADER_H + PAD + COLS_H;
  const height = Math.ceil(bodyTop + spec.rows.length * TABLE_ROW_HEIGHT + PAD + BORDER);
  return { width, height, bodyTop, rowHeight: TABLE_ROW_HEIGHT, rowCount: spec.rows.length, columns, keyColumn: spec.keyColumn };
}

function pill(ctx: CanvasRenderingContext2D, label: string, x: number, cy: number, color: string, fonts: Fonts): number {
  ctx.font = `700 ${PILL_FONT}px ${fonts.data}`;
  const w = ctx.measureText(label).width + 8;
  const h = PILL_FONT + 4;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, cy - h / 2 + 0.5, w - 1, h - 1);
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + 4, cy + 0.5);
  return w;
}

export function drawTable(spec: TableSpec, layout: TableLayout, fonts: Fonts, highlight: ColumnHighlight | null): CanvasTexture {
  const active = highlight !== null;
  const canvas = document.createElement('canvas');
  canvas.width = layout.width * SCALE;
  canvas.height = layout.height * SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.scale(SCALE, SCALE);
  const { width, height, bodyTop, rowHeight, columns } = layout;
  const pkIndices = new Set(spec.columns.map((c, i) => (c.pk ? i : -1)).filter((i) => i >= 0));

  // Body and frame (border-[1.5px], bg-node).
  ctx.fillStyle = surfaces.node;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = active ? accents.active : lines.strong;
  ctx.lineWidth = BORDER;
  ctx.strokeRect(BORDER / 2, BORDER / 2, width - BORDER, height - BORDER);

  // Header bar: name left, row count right.
  ctx.fillStyle = surfaces.nodeHeader;
  ctx.fillRect(BORDER, BORDER, width - BORDER * 2, HEADER_H);
  ctx.fillStyle = active ? rgba(accents.active, 0.4) : lines.strong;
  ctx.fillRect(BORDER, BORDER + HEADER_H - 1, width - BORDER * 2, 1);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = text.primary;
  ctx.font = `500 ${NAME_FONT}px ${fonts.ui}`;
  ctx.fillText(spec.name, BORDER + 10, BORDER + HEADER_H / 2 + 0.5);
  ctx.fillStyle = text.secondary;
  ctx.font = `400 ${META_FONT}px ${fonts.data}`;
  ctx.textAlign = 'right';
  ctx.fillText(`${spec.rows.length} rows`, width - BORDER - 10, BORDER + HEADER_H / 2 + 1);
  ctx.textAlign = 'left';

  // Column header row (bg-node-header/50, border-b line).
  const colsTop = bodyTop - COLS_H;
  ctx.fillStyle = rgba(surfaces.nodeHeader, 0.5);
  ctx.fillRect(BORDER + PAD, colsTop, width - (BORDER + PAD) * 2, COLS_H);
  ctx.fillStyle = lines.default;
  ctx.fillRect(BORDER + PAD, colsTop + COLS_H - 1, width - (BORDER + PAD) * 2, 1);
  const colMid = colsTop + COLS_H / 2;
  spec.columns.forEach((c, ci) => {
    const col = columns[ci];
    const lit = highlight?.columns.includes(ci) ?? false;
    const tone = highlight?.color ?? accents.active;
    let x = col.textLeft;
    if (lit) {
      ctx.fillStyle = rgba(tone, 0.2);
      ctx.fillRect(col.left, colsTop, col.width, COLS_H - 1);
      ctx.fillStyle = tone;
      ctx.fillRect(col.left, colsTop + COLS_H - 3, col.width, 2);
    }
    ctx.font = `700 ${COL_FONT}px ${fonts.data}`;
    ctx.fillStyle = lit ? tone : text.secondary;
    ctx.textBaseline = 'middle';
    ctx.fillText(c.name, x, colMid + 0.5);
    const nameW = ctx.measureText(c.name).width;
    if (c.pk) {
      ctx.fillStyle = rgba(accents.active, 0.8);
      ctx.fillRect(x, colMid + 7, nameW, 1.5);
    }
    x += nameW + 4;
    if (c.type) {
      ctx.font = `400 ${TYPE_FONT}px ${fonts.data}`;
      ctx.fillStyle = text.muted;
      const label = c.type.toUpperCase();
      ctx.fillText(label, x, colMid + 1);
      x += ctx.measureText(label).width + 4;
    }
    if (c.pk) x += pill(ctx, 'PK', x, colMid, accents.active, fonts) + 4;
    if (c.fk) x += pill(ctx, 'FK', x, colMid, text.secondary, fonts) + 4;
  });

  // Data rows: zebra, cell separators, PK columns dimmed.
  ctx.font = `400 ${CELL_FONT}px ${fonts.data}`;
  ctx.textBaseline = 'middle';
  spec.rows.forEach((row, ri) => {
    const top = bodyTop + ri * rowHeight;
    if (ri % 2 === 1) {
      ctx.fillStyle = surfaces.rowAlt;
      ctx.fillRect(BORDER + PAD, top + 1, width - (BORDER + PAD) * 2, rowHeight - 2);
    }
    row.forEach((v, ci) => {
      const col = columns[ci];
      if (ci < row.length - 1) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.fillRect(col.left + col.width - 1, top + 1, 1, rowHeight - 2);
      }
      ctx.fillStyle = pkIndices.has(ci) ? text.secondary : text.primary;
      ctx.fillText(String(v), col.textLeft, top + rowHeight / 2 + 0.5);
    });
  });

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.generateMipmaps = true;
  return texture;
}

/** Reads the site's font stacks from the CSS variables next/font sets on <html>. */
export function readFonts(): Fonts {
  const style = getComputedStyle(document.documentElement);
  const data = style.getPropertyValue('--font-data').trim();
  const ui = style.getPropertyValue('--font-ui').trim();
  return {
    data: `${data ? `${data}, ` : ''}ui-monospace, "SFMono-Regular", Menlo, monospace`,
    ui: `${ui ? `${ui}, ` : ''}system-ui, sans-serif`,
  };
}
