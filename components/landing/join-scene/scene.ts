import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CurvePath,
  DynamicDrawUsage,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineCurve3,
  LineSegments,
  Material,
  Mesh,
  MeshBasicMaterial,
  NoToneMapping,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  QuadraticBezierCurve3,
  Quaternion,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Texture,
  TubeGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { accents, grid, lines, surfaces } from '@/styles/theme';
import { MATCHES, SCREENING, VENUE, type TableSpec } from './joinData';
import { drawTable, layoutTable, type Fonts, type TableLayout } from './tableTexture';

/**
 * The landing hero. SCREENING and VENUE face the screen the way the tracer
 * lays them out, built from physical slabs, one per row, that rise out of
 * the backdrop and stack. The join plays the way the tracer draws it
 * (components/FKEdge.tsx: a wire between the key columns, two pulses
 * circulating, matched rows lit) and then goes further: the selected cells
 * lift off each matched pair and fly toward the viewer to assemble the
 * result table below. The sequence plays once and holds its final frame.
 *
 * Everything is allocated in `createJoinScene`; the frame loop only mutates.
 * Colours are the theme's own (styles/theme.ts), rendered without tone
 * mapping so they match the page.
 */

export type JoinPhase = 'assemble' | 'connect' | 'match' | 'project' | 'hold';

export interface JoinSceneOptions {
  fonts: Fonts;
  /** Coarse pointer / small screen: lower pixel ratio, no bloom, no dust. */
  lite: boolean;
  onPhase: (phase: JoinPhase) => void;
  /** First frame has been drawn. */
  onReady: () => void;
  onComplete: () => void;
  onFail: () => void;
}

export interface JoinSceneHandle {
  setSize: (width: number, height: number) => void;
  /** Normalised pointer position in [-1, 1]; (0, 0) when the pointer leaves. */
  setPointer: (x: number, y: number) => void;
  setRunning: (running: boolean) => void;
  /** Draw one frame at a moment of the sequence without animating (reduced motion). */
  renderStill: (seconds: number) => void;
  dispose: () => void;
}

/* ------------------------------------------------------------ timeline */

const T_CONNECT = 2.0;
const T_MATCH = 3.2;
const ASSEMBLE_STAGGER = 0.055;
const ASSEMBLE_DUR = 1.1;
const WIRE_DRAW = 1.0;
const MATCH_START = 3.4;
const MATCH_GAP = 1.15;
const SPARK_DUR = 0.55;
/** The result header begins arriving, just ahead of the first cell flight. */
const T_PROJECT = MATCH_START + SPARK_DUR - 0.1;
const FLIGHT_DUR = 0.95;
const RESULT_REVEAL_DUR = 0.22;
const FLIGHT_FADE_DUR = 0.18;
const LIGHT_DUR = 0.3;
const FLASH_DUR = 0.6;
const PULSE_PERIOD = 1.4;
const T_HOLD = MATCH_START + (MATCHES.length - 1) * MATCH_GAP + SPARK_DUR + FLIGHT_DUR + RESULT_REVEAL_DUR + FLIGHT_FADE_DUR;
/** The sequence freezes here, once the last flash has faded. */
export const T_END = T_HOLD + 1.2;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOutCubic = (v: number) => 1 - Math.pow(1 - clamp01(v), 3);
const easeInOut = (v: number) => { const t = clamp01(v); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
/** Zero velocity and acceleration at both ends, including the cell handoff. */
const smootherstep = (v: number) => { const t = clamp01(v); return t * t * t * (t * (t * 6 - 15) + 10); };
const bell = (v: number) => Math.sin(Math.PI * clamp01(v));

function phaseAt(t: number): JoinPhase {
  if (t < T_CONNECT) return 'assemble';
  if (t < T_MATCH) return 'connect';
  if (t < T_PROJECT) return 'match';
  if (t < T_HOLD) return 'project';
  return 'hold';
}

/* -------------------------------------------------------------- layout */

/** World units per CSS pixel of table texture. */
const UNIT = 1 / 110;
const ROW_DEPTH = 0.05;
const CAP_DEPTH = 0.085;
const CELL_DEPTH = 0.03;
const BACKDROP_Z = -0.6;
/** Narrow lens: the view stays nearly flat, only the flying cells show depth. */
const FOV = 24;

interface Placement {
  screening: { x: number; y: number };
  venue: { x: number; y: number };
  result: { x: number; y: number };
  frameW: number;
  frameH: number;
  target: Vector3;
}

const LANDSCAPE: Placement = {
  screening: { x: -2.55, y: 1.15 },
  venue: { x: 2.55, y: -1.15 },
  result: { x: 3.45, y: 1.95 },
  frameW: 11.6,
  frameH: 7.0,
  target: new Vector3(0.2, 0.1, 0),
};

const PORTRAIT: Placement = {
  screening: { x: 0, y: 2.75 },
  venue: { x: 0.55, y: 0.2 },
  result: { x: 0.1, y: -2.35 },
  frameW: 7.0,
  frameH: 8.6,
  target: new Vector3(0.1, 0.15, 0),
};

/** The query's projection: what the join produces. */
const RESULT: TableSpec = {
  name: 'RESULT',
  columns: [
    { name: 'VENUE_NAME', type: 'VARCHAR(30)' },
    { name: 'FILM_TITLE', type: 'VARCHAR(40)' },
    { name: 'SCREENING_DAY', type: 'VARCHAR(10)' },
  ],
  rows: MATCHES.map(([si, vi]) => [VENUE.rows[vi][1], SCREENING.rows[si][1], SCREENING.rows[si][3]]),
  keyColumn: -1,
};

/** Which source cells fly into each result column: [table, column index]. */
const PROJECTION: Array<['venue' | 'screening', number]> = [['venue', 1], ['screening', 1], ['screening', 3]];

/* ------------------------------------------------------------- helpers */

function glowTexture(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}

const GRID_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

/* Anti-aliased drafting grid behind the tables, fading toward the edges. */
const GRID_FRAGMENT = /* glsl */ `
  uniform vec3 uMinor;
  uniform vec3 uMajor;
  uniform float uFade;
  varying vec3 vWorld;
  float gridLine(vec2 p, float step) {
    vec2 q = p / step;
    vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q);
    return 1.0 - min(min(g.x, g.y), 1.0);
  }
  void main() {
    vec2 p = vWorld.xy;
    float minor = gridLine(p, 0.5);
    float major = gridLine(p, 2.5);
    vec3 col = mix(uMinor, uMajor, major);
    float a = max(minor * 0.85, major);
    a *= 1.0 - smoothstep(3.0, uFade, length(p));
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }
`;

const GLOW_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  uniform float uScale;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (uScale / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const GLOW_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    float m = texture2D(uMap, gl_PointCoord).a;
    if (m < 0.01) discard;
    gl_FragColor = vec4(uColor * m * vAlpha, m * vAlpha);
    #include <colorspace_fragment>
  }
`;

// Clip continuously in path space instead of revealing discrete tube triangles.
const WIRE_VERTEX = /* glsl */ `
  varying float vProgress;
  void main() {
    vProgress = uv.x;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const WIRE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uReveal;
  uniform float uOpacity;
  varying float vProgress;
  void main() {
    float edge = max(fwidth(vProgress), 0.0001);
    float alpha = 1.0 - smoothstep(uReveal - edge, uReveal + edge, vProgress);
    if (alpha <= 0.0) discard;
    gl_FragColor = vec4(uColor, alpha * uOpacity);
    #include <colorspace_fragment>
  }
`;

interface Region { x0: number; y0: number; x1: number; y1: number }

/** A plane showing one rectangle of a table texture, sized in world units. */
function regionGeometry(region: Region, texW: number, texH: number): PlaneGeometry {
  const w = (region.x1 - region.x0) * UNIT;
  const h = (region.y1 - region.y0) * UNIT;
  const geo = new PlaneGeometry(w, h);
  const u0 = region.x0 / texW;
  const u1 = region.x1 / texW;
  const v0 = 1 - region.y1 / texH;
  const v1 = 1 - region.y0 / texH;
  geo.setAttribute('uv', new Float32BufferAttribute([u0, v1, u1, v1, u0, v0, u1, v0], 2));
  return geo;
}

/** One physical piece of a table: a box with a textured front, glowing edges, and light overlays. */
interface Slab {
  group: Group;
  /** Rest position inside the table group (card space). */
  rest: Vector3;
  w: number;
  h: number;
  face: MeshBasicMaterial;
  activeFace: MeshBasicMaterial | null;
  /** Cap only: the SELECT-stage texture (projected columns in mint). */
  selectFace: MeshBasicMaterial | null;
  sides: MeshBasicMaterial;
  edge: LineBasicMaterial;
  overlay: MeshBasicMaterial;
  bar: MeshBasicMaterial | null;
  keyCell: MeshBasicMaterial | null;
  /** Rows only: mint tint over the projected cells at the SELECT stage. */
  selectCells: MeshBasicMaterial[];
  /** Deterministic per-slab variation for the assemble path. */
  seed: number;
}

interface SlabOptions {
  depth: number;
  active?: Texture | null;
  select?: Texture | null;
  keyRegion?: Region | null;
  selectRegions?: Region[];
  bar?: boolean;
  seed: number;
}

const _v = new Vector3();
const _q = new Quaternion();
const _color = new Color();

function makeSlab(texture: Texture, layout: TableLayout, region: Region, opts: SlabOptions): Slab {
  const group = new Group();
  const w = (region.x1 - region.x0) * UNIT;
  const h = (region.y1 - region.y0) * UNIT;
  const sides = new MeshBasicMaterial({ color: surfaces.panel, transparent: true, opacity: 0 });
  const box = new Mesh(new BoxGeometry(w, h, opts.depth), sides);
  box.position.z = -opts.depth / 2;
  // Caps show their full box outline; rows get a clean front outline so a
  // stack of lit rows reads as lines, not stripes.
  const edge = new LineBasicMaterial({ color: lines.default, transparent: true, opacity: 0 });
  const edges = opts.bar
    ? new LineSegments(new EdgesGeometry(new PlaneGeometry(w, h)), edge)
    : new LineSegments(new EdgesGeometry(box.geometry), edge);
  edges.position.z = opts.bar ? 0.0015 : -opts.depth / 2;
  const face = new MeshBasicMaterial({ map: texture, transparent: true, opacity: 0 });
  const faceMesh = new Mesh(regionGeometry(region, layout.width, layout.height), face);
  faceMesh.position.z = 0.001;
  group.add(box, edges, faceMesh);

  let activeFace: MeshBasicMaterial | null = null;
  if (opts.active) {
    activeFace = new MeshBasicMaterial({ map: opts.active, transparent: true, opacity: 0, depthWrite: false });
    const m = new Mesh(faceMesh.geometry, activeFace);
    m.position.z = 0.002;
    m.renderOrder = 1;
    group.add(m);
  }
  let selectFace: MeshBasicMaterial | null = null;
  if (opts.select) {
    selectFace = new MeshBasicMaterial({ map: opts.select, transparent: true, opacity: 0, depthWrite: false });
    const m = new Mesh(faceMesh.geometry, selectFace);
    m.position.z = 0.0025;
    m.renderOrder = 1;
    group.add(m);
  }

  const overlay = new MeshBasicMaterial({ color: accents.active, transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending });
  const overlayMesh = new Mesh(new PlaneGeometry(w - 0.02, h - 0.004), overlay);
  overlayMesh.position.z = 0.003;
  overlayMesh.renderOrder = 2;
  group.add(overlayMesh);

  let bar: MeshBasicMaterial | null = null;
  if (opts.bar) {
    bar = new MeshBasicMaterial({ color: accents.active, transparent: true, opacity: 0, depthWrite: false });
    const barMesh = new Mesh(new PlaneGeometry(4 * UNIT, h - 0.004), bar);
    barMesh.position.set(-w / 2 + (1.5 + 4) * UNIT + 2 * UNIT, 0, 0.004);
    barMesh.renderOrder = 2;
    group.add(barMesh);
  }

  let keyCell: MeshBasicMaterial | null = null;
  if (opts.keyRegion) {
    keyCell = new MeshBasicMaterial({ color: accents.active, transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending });
    const kw = (opts.keyRegion.x1 - opts.keyRegion.x0) * UNIT;
    const kx = ((opts.keyRegion.x0 + opts.keyRegion.x1) / 2 - (region.x0 + region.x1) / 2) * UNIT;
    const keyMesh = new Mesh(new PlaneGeometry(kw, h - 0.004), keyCell);
    keyMesh.position.set(kx, 0, 0.004);
    keyMesh.renderOrder = 2;
    group.add(keyMesh);
  }

  const selectCells: MeshBasicMaterial[] = [];
  for (const r of opts.selectRegions ?? []) {
    const mat = new MeshBasicMaterial({ color: accents.result, transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending });
    const cw = (r.x1 - r.x0) * UNIT;
    const cx = ((r.x0 + r.x1) / 2 - (region.x0 + region.x1) / 2) * UNIT;
    const mesh = new Mesh(new PlaneGeometry(cw, h - 0.004), mat);
    mesh.position.set(cx, 0, 0.0045);
    mesh.renderOrder = 2;
    group.add(mesh);
    selectCells.push(mat);
  }

  const rest = new Vector3(((region.x0 + region.x1) / 2 - layout.width / 2) * UNIT, (layout.height / 2 - (region.y0 + region.y1) / 2) * UNIT, 0);
  group.position.copy(rest);
  return { group, rest, w, h, face, activeFace, selectFace, sides, edge, overlay, bar, keyCell, selectCells, seed: opts.seed };
}

function setSlabOpacity(slab: Slab, k: number) {
  // Fully transparent geometry must not occlude other rows or consume draws.
  slab.group.visible = k > 0;
  slab.face.opacity = k;
  slab.sides.opacity = k;
  slab.edge.opacity = k;
}

/** Orthogonal routing with small, tangent-continuous bends at the elbows. */
function roundedRoute(points: Vector3[], radius: number): CurvePath<Vector3> {
  const path = new CurvePath<Vector3>();
  let start = points[0];
  for (let i = 1; i < points.length - 1; i++) {
    const corner = points[i];
    const before = points[i - 1];
    const after = points[i + 1];
    const r = Math.min(radius, corner.distanceTo(before) / 2, corner.distanceTo(after) / 2);
    const entry = corner.clone().addScaledVector(before.clone().sub(corner).normalize(), r);
    const exit = corner.clone().addScaledVector(after.clone().sub(corner).normalize(), r);
    path.add(new LineCurve3(start, entry));
    path.add(new QuadraticBezierCurve3(entry, corner, exit));
    start = exit;
  }
  path.add(new LineCurve3(start, points[points.length - 1]));
  // Populate arc-length caches during setup, never on a spark's first frame.
  path.getLengths();
  return path;
}

interface Table {
  spec: TableSpec;
  layout: TableLayout;
  group: Group;
  idle: Texture;
  active: Texture | null;
  select: Texture | null;
  cap: Slab;
  rows: Slab[];
  /** Every slab in stacking order (cap first). */
  slabs: Slab[];
}

function cellRegion(layout: TableLayout, ci: number, ri: number): Region {
  const col = layout.columns[ci];
  const y0 = layout.bodyTop + ri * layout.rowHeight;
  return { x0: col.left, x1: col.left + col.width, y0: y0 + 1, y1: y0 + layout.rowHeight - 1 };
}

/** Columns this table contributes to the query's SELECT list. */
interface TableStages {
  /** Light the key column at JOIN. */
  join: boolean;
  /** Light these columns in mint at SELECT. */
  select: number[];
}

function buildTable(spec: TableSpec, fonts: Fonts, stages: TableStages, seedBase: number): Table {
  const layout = layoutTable(spec, fonts);
  const idle = drawTable(spec, layout, fonts, null);
  const active = stages.join ? drawTable(spec, layout, fonts, { columns: [spec.keyColumn], color: accents.active }) : null;
  const select = stages.select.length ? drawTable(spec, layout, fonts, { columns: stages.select, color: accents.result }) : null;
  const group = new Group();
  const key = layout.keyColumn >= 0 ? layout.columns[layout.keyColumn] : null;
  const keyRegion = key ? { x0: key.left, x1: key.left + key.width, y0: 0, y1: 0 } : null;

  const cap = makeSlab(idle, layout, { x0: 0, y0: 0, x1: layout.width, y1: layout.bodyTop }, {
    depth: CAP_DEPTH, active, select, seed: seedBase,
  });
  const rows: Slab[] = [];
  for (let ri = 0; ri < layout.rowCount; ri++) {
    const y0 = layout.bodyTop + ri * layout.rowHeight;
    rows.push(makeSlab(idle, layout, { x0: 0, y0: y0 + 1, x1: layout.width, y1: y0 + layout.rowHeight - 1 }, {
      depth: ROW_DEPTH, keyRegion, bar: true, seed: seedBase + ri + 1,
      selectRegions: stages.select.map((ci) => cellRegion(layout, ci, ri)),
    }));
  }
  const slabs = [cap, ...rows];
  for (const s of slabs) group.add(s.group);
  return { spec, layout, group, idle, active, select, cap, rows, slabs };
}

/** World position of a texture-pixel point on a table's face, at rest. */
function tablePoint(table: Table, px: number, py: number, out: Vector3): Vector3 {
  out.set((px - table.layout.width / 2) * UNIT, (table.layout.height / 2 - py) * UNIT, 0.01);
  return table.group.localToWorld(out);
}

function keyX(table: Table): number {
  const col = table.layout.columns[table.layout.keyColumn];
  return col.left + col.width / 2;
}

/** A cell copy in flight from a source table to the result. */
interface Flight {
  group: Group;
  face: MeshBasicMaterial;
  sides: MeshBasicMaterial;
  from: Vector3;
  to: Vector3;
  ctrl: Vector3;
}

function disposeObject(root: Object3D) {
  root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material as Material | Material[] | undefined;
    if (!material) return;
    for (const m of Array.isArray(material) ? material : [material]) {
      for (const value of Object.values(m)) if (value instanceof Texture) value.dispose();
      m.dispose();
    }
  });
}

/* ---------------------------------------------------------------- scene */

export function createJoinScene(canvas: HTMLCanvasElement, opts: JoinSceneOptions): JoinSceneHandle {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  const pixelRatio = Math.min(window.devicePixelRatio || 1, opts.lite ? 1.5 : 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.toneMapping = NoToneMapping;
  renderer.outputColorSpace = SRGBColorSpace;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const scene = new Scene();
  scene.background = new Color(surfaces.app);
  const camera = new PerspectiveCamera(FOV, 1, 0.5, 120);
  const stage = new Group();
  scene.add(stage);

  // Backdrop grid, behind the slabs.
  const gridMat = new ShaderMaterial({
    vertexShader: GRID_VERTEX,
    fragmentShader: GRID_FRAGMENT,
    uniforms: {
      uMinor: { value: new Color(grid.minor).multiplyScalar(1.2) },
      uMajor: { value: new Color(grid.major).multiplyScalar(1.2) },
      uFade: { value: 9.5 },
    },
    transparent: true,
    depthWrite: false,
  });
  const backdrop = new Mesh(new PlaneGeometry(80, 80), gridMat);
  backdrop.position.z = BACKDROP_Z;
  backdrop.renderOrder = -1;
  stage.add(backdrop);

  // Tables.
  const screening = buildTable(SCREENING, opts.fonts, { join: true, select: PROJECTION.filter(([t]) => t === 'screening').map(([, ci]) => ci) }, 0);
  const venue = buildTable(VENUE, opts.fonts, { join: true, select: PROJECTION.filter(([t]) => t === 'venue').map(([, ci]) => ci) }, 20);
  const result = buildTable(RESULT, opts.fonts, { join: false, select: [] }, 40);
  for (const table of [screening, venue, result]) {
    for (const tex of [table.idle, table.active, table.select]) if (tex) tex.anisotropy = maxAniso;
    stage.add(table.group);
  }
  for (const slab of result.rows) slab.overlay.color.set(accents.result);
  const assembling = [...screening.slabs, ...venue.slabs];

  // Wire and end markers.
  const idleWire = new Color(lines.strong);
  const liveWire = new Color(accents.active);
  const wireMat = new ShaderMaterial({
    vertexShader: WIRE_VERTEX,
    fragmentShader: WIRE_FRAGMENT,
    uniforms: { uColor: { value: idleWire.clone() }, uReveal: { value: 0 }, uOpacity: { value: 0 } },
    transparent: true,
    depthWrite: false,
  });
  const markerMat = new MeshBasicMaterial({ color: idleWire, transparent: true, opacity: 0, depthWrite: false });
  const square = new Mesh(new BoxGeometry(0.075, 0.075, 0.075), markerMat);
  const arrow = new Mesh(new ConeGeometry(0.055, 0.16, 4), markerMat);
  stage.add(square, arrow);
  let wire: Mesh<TubeGeometry, ShaderMaterial> | null = null;
  let wireCurve: CurvePath<Vector3> | null = null;
  let wireLength = 1;
  const sparkCurves: CurvePath<Vector3>[] = [];
  const anchorA = new Vector3();
  const anchorB = new Vector3();
  const UP = new Vector3(0, 1, 0);
  const tangent = new Vector3();

  // Flights: three cell copies per match.
  const flights: Flight[] = [];
  MATCHES.forEach((_, mi) => {
    PROJECTION.forEach((_, rc) => {
      // Use the destination's dimensions, padding, and zebra texture throughout
      // flight so the text does not resize or jump when it becomes a result row.
      const region = cellRegion(result.layout, rc, mi);
      const w = (region.x1 - region.x0) * UNIT;
      const h = (region.y1 - region.y0) * UNIT;
      const group = new Group();
      const face = new MeshBasicMaterial({ map: result.idle, transparent: true, opacity: 0, depthWrite: false });
      const sides = new MeshBasicMaterial({ color: surfaces.nodeHeader, transparent: true, opacity: 0, depthWrite: false });
      const box = new Mesh(new BoxGeometry(w, h, CELL_DEPTH), sides);
      box.position.z = -CELL_DEPTH / 2;
      const faceMesh = new Mesh(regionGeometry(region, result.layout.width, result.layout.height), face);
      faceMesh.position.z = 0.001;
      group.add(box, faceMesh);
      group.visible = false;
      stage.add(group);
      flights.push({ group, face, sides, from: new Vector3(), to: new Vector3(), ctrl: new Vector3() });
    });
  });

  // Glow particles: pulses with trails, sparks with trails. One draw call.
  const glow = glowTexture();
  const PULSES = 2;
  const TRAIL = 10;
  const SPARK_TRAIL = 5;
  const glowCount = PULSES * (1 + TRAIL) + MATCHES.length * (1 + SPARK_TRAIL);
  const glowGeo = new BufferGeometry();
  const glowPos = new Float32BufferAttribute(new Float32Array(glowCount * 3), 3).setUsage(DynamicDrawUsage);
  const glowSize = new Float32BufferAttribute(new Float32Array(glowCount), 1).setUsage(DynamicDrawUsage);
  const glowAlpha = new Float32BufferAttribute(new Float32Array(glowCount), 1).setUsage(DynamicDrawUsage);
  glowGeo.setAttribute('position', glowPos);
  glowGeo.setAttribute('aSize', glowSize);
  glowGeo.setAttribute('aAlpha', glowAlpha);
  const glowMat = new ShaderMaterial({
    vertexShader: GLOW_VERTEX,
    fragmentShader: GLOW_FRAGMENT,
    uniforms: { uMap: { value: glow }, uColor: { value: new Color(accents.pulse).multiplyScalar(1.6) }, uScale: { value: 300 } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const glows = new Points(glowGeo, glowMat);
  glows.frustumCulled = false;
  glows.renderOrder = 3;
  stage.add(glows);

  // Dust floating in front of the backdrop (desktop only).
  let dust: Points | null = null;
  if (!opts.lite) {
    const n = 320;
    const positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 18;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 12;
      positions[i * 3 + 2] = BACKDROP_Z + 0.2 + Math.random() * 2.2;
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
    const mat = new PointsMaterial({
      color: accents.pulse, map: glow, size: 0.06, transparent: true, opacity: 0.22,
      depthWrite: false, blending: AdditiveBlending, sizeAttenuation: true,
    });
    dust = new Points(geo, mat);
    stage.add(dust);
  }

  // Bloom (desktop only): only the additive glows and over-bright lit edges cross the threshold.
  let composer: EffectComposer | null = null;
  let bloom: UnrealBloomPass | null = null;
  if (!opts.lite) {
    composer = new EffectComposer(renderer);
    composer.setPixelRatio(pixelRatio);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new Vector2(1, 1), 0.9, 0.55, 1.0);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }

  /* ---- placement and routing ---- */

  let placement: Placement = LANDSCAPE;
  let baseDistance = 12;

  function restPose(table: Table) {
    for (const s of table.slabs) s.group.position.copy(s.rest);
    table.group.updateMatrixWorld(true);
  }

  function route() {
    if (wire) { stage.remove(wire); wire.geometry.dispose(); wire = null; }
    restPose(screening);
    restPose(venue);
    restPose(result);
    // SCREENING's VENUE_ID leaves the table's bottom edge; VENUE's enters at its top edge.
    tablePoint(screening, keyX(screening), screening.layout.height, anchorA);
    tablePoint(venue, keyX(venue), 0, anchorB);
    anchorA.z = 0;
    anchorB.z = 0;
    const yMid = (anchorA.y + anchorB.y) / 2;
    const pts = [
      anchorA.clone(),
      new Vector3(anchorA.x, yMid, 0),
      new Vector3(anchorB.x, yMid, 0),
      anchorB.clone(),
    ];
    wireCurve = roundedRoute(pts, 0.18);
    wireLength = wireCurve.getLength();
    const geo = new TubeGeometry(wireCurve, 192, 0.014, 8, false);
    wire = new Mesh(geo, wireMat);
    stage.add(wire);

    square.position.copy(anchorA);

    // Spark path per match: key cell -> wire -> matched key cell.
    sparkCurves.length = 0;
    for (const [si, vi] of MATCHES) {
      const path = new CurvePath<Vector3>();
      const from = tablePoint(screening, keyX(screening), screening.layout.bodyTop + (si + 0.5) * screening.layout.rowHeight, new Vector3());
      const to = tablePoint(venue, keyX(venue), venue.layout.bodyTop + (vi + 0.5) * venue.layout.rowHeight, new Vector3());
      path.add(new LineCurve3(from, pts[0]));
      for (const segment of wireCurve.curves) path.add(segment);
      path.add(new LineCurve3(anchorB, to));
      path.getLengths();
      sparkCurves.push(path);
    }

    // Flight paths: from the source cell's centre to the result cell's centre,
    // arcing out toward the viewer.
    let f = 0;
    MATCHES.forEach(([si, vi], mi) => {
      PROJECTION.forEach(([from, ci], rc) => {
        const flight = flights[f++];
        const table = from === 'venue' ? venue : screening;
        const ri = from === 'venue' ? vi : si;
        const src = cellRegion(table.layout, ci, ri);
        const dst = cellRegion(result.layout, rc, mi);
        const dstCenter = (dst.x0 + dst.x1) / 2;
        const sourceCenter = table.layout.columns[ci].textLeft + dstCenter - result.layout.columns[rc].textLeft;
        tablePoint(table, sourceCenter, (src.y0 + src.y1) / 2, flight.from);
        tablePoint(result, (dst.x0 + dst.x1) / 2, (dst.y0 + dst.y1) / 2, flight.to);
        flight.to.z = 0.003;
        flight.ctrl.lerpVectors(flight.from, flight.to, 0.5).add(_v.set(0, 0.25, 1.3 + 0.2 * rc));
      });
    });
  }

  function place(next: Placement) {
    placement = next;
    screening.group.position.set(next.screening.x, next.screening.y, 0);
    venue.group.position.set(next.venue.x, next.venue.y, 0);
    result.group.position.set(next.result.x, next.result.y, 0);
    route();
  }

  function frameCamera(aspect: number) {
    const halfTan = Math.tan((FOV * Math.PI) / 360);
    baseDistance = Math.max(placement.frameW / 2 / (halfTan * aspect), placement.frameH / 2 / halfTan);
  }

  place(LANDSCAPE);

  /* ---- state ---- */

  let width = 1;
  let height = 1;
  let time = 0;
  let last = 0;
  let raf = 0;
  let running = false;
  let finished = false;
  let disposed = false;
  let ready = false;
  let phase: JoinPhase | null = null;
  const pointer = { x: 0, y: 0 };
  const eased = { x: 0, y: 0 };
  const camTarget = new Vector3();

  function setSize(w: number, h: number) {
    width = Math.max(1, w);
    height = Math.max(1, h);
    renderer.setSize(width, height, false);
    composer?.setSize(width, height);
    const aspect = width / height;
    const next = aspect < 1 ? PORTRAIT : LANDSCAPE;
    if (next !== placement) place(next);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    frameCamera(aspect);
    glowMat.uniforms.uScale.value = (height * pixelRatio) / 2;
    if (!running && ready) { update(0, Math.min(time, T_END)); render(); }
  }

  function setPointer(x: number, y: number) {
    pointer.x = x;
    pointer.y = y;
  }

  /* ---- per-frame update ---- */

  const litEdge = new Color(accents.active).multiplyScalar(1.8);
  const flashEdge = new Color(accents.pulse).multiplyScalar(3);
  const idleEdge = new Color(lines.default);
  const resultEdge = new Color(accents.result).multiplyScalar(1.6);
  const litS = new Float32Array(SCREENING.rows.length);
  const liftS = new Float32Array(SCREENING.rows.length);
  const litV = new Float32Array(VENUE.rows.length);
  const liftV = new Float32Array(VENUE.rows.length);
  const flashV = new Float32Array(VENUE.rows.length);
  const landed = new Float32Array(MATCHES.length);
  const landFlash = new Float32Array(MATCHES.length);

  function paintRow(slab: Slab, lit: number, lift: number, flash: number, selecting: number) {
    slab.overlay.opacity = 0.28 * lit;
    for (const cell of slab.selectCells) cell.opacity = 0.2 * lit * selecting;
    if (slab.bar) slab.bar.opacity = lit;
    if (slab.keyCell) slab.keyCell.opacity = 0.16 * lit;
    // The row in motion glows hardest; settled lit rows keep a softer outline.
    _color.lerpColors(idleEdge, litEdge, lit * (0.4 + 0.6 * lift));
    if (flash > 0) _color.lerp(flashEdge, flash * 0.7);
    slab.edge.color.copy(_color);
    // poseSlab has already placed the slab this frame; the lift rides on top.
    slab.group.position.z += lift * 0.12;
  }

  function writeGlow(i: number, p: Vector3 | null, size: number, alpha: number) {
    const arr = glowPos.array as Float32Array;
    if (p) { arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z; }
    (glowSize.array as Float32Array)[i] = size;
    (glowAlpha.array as Float32Array)[i] = p ? alpha : 0;
  }

  /** Rises from below and from behind the backdrop, fading in. */
  function poseSlab(slab: Slab, k: number) {
    const sink = 1 - k;
    slab.group.position.set(
      slab.rest.x + sink * (0.12 * Math.sin(slab.seed * 1.7)),
      slab.rest.y - sink * (0.7 + 0.25 * Math.sin(slab.seed * 2.3)),
      slab.rest.z - sink * 1.4,
    );
    slab.group.rotation.x = -sink * 0.5;
    setSlabOpacity(slab, k);
  }

  function update(dt: number, fixed?: number) {
    if (fixed === undefined) time += dt;
    const t = fixed !== undefined ? fixed : Math.min(time, T_END);
    const current = phaseAt(t);
    if (current !== phase) { phase = current; opts.onPhase(current); }

    // Tables rise piece by piece.
    assembling.forEach((slab, k) => poseSlab(slab, easeOutCubic((t - k * ASSEMBLE_STAGGER) / ASSEMBLE_DUR)));
    const assembled = easeOutCubic((t - (assembling.length - 1) * ASSEMBLE_STAGGER) / ASSEMBLE_DUR);

    // Connect: key columns light and the wire draws on.
    const drawn = smootherstep((t - T_CONNECT) / WIRE_DRAW);
    if (wire && wireCurve) {
      const appear = smootherstep((t - T_CONNECT) / 0.18);
      wire.visible = square.visible = arrow.visible = drawn > 0;
      wireMat.uniforms.uReveal.value = Math.max(0, drawn - 0.08 / wireLength);
      wireMat.uniforms.uOpacity.value = appear;
      wireMat.uniforms.uColor.value.lerpColors(idleWire, liveWire, drawn);
      markerMat.color.copy(wireMat.uniforms.uColor.value);
      markerMat.opacity = appear;
      square.scale.setScalar(Math.max(0.0001, appear));
      // The tip leads the reveal and follows the rounded bends into the key.
      wireCurve.getPointAt(drawn, arrow.position);
      wireCurve.getPointAt(Math.min(1, drawn + 0.001), tangent);
      wireCurve.getPointAt(Math.max(0, drawn - 0.001), _v);
      tangent.sub(_v).normalize();
      arrow.position.addScaledVector(tangent, -0.08);
      arrow.quaternion.copy(_q.setFromUnitVectors(UP, tangent));
    }
    // SELECT: once the result is assembled, the projected columns turn mint.
    const selecting = t < T_HOLD ? 0 : easeOutCubic((t - T_HOLD) / 0.5);
    for (const table of [screening, venue]) {
      if (table.cap.activeFace) table.cap.activeFace.opacity = drawn * assembled * (1 - selecting);
      if (table.cap.selectFace) table.cap.selectFace.opacity = selecting * assembled;
      _color.lerpColors(idleEdge, litEdge, drawn * 0.6);
      table.cap.edge.color.copy(_color);
    }

    // Matches: lights, lifts, sparks, flights, result rows.
    litS.fill(0); liftS.fill(0); litV.fill(0); liftV.fill(0); flashV.fill(0); landed.fill(0); landFlash.fill(0);
    let glowIndex = PULSES * (1 + TRAIL);
    MATCHES.forEach(([si, vi], i) => {
      const start = MATCH_START + i * MATCH_GAP;
      const arrive = start + SPARK_DUR;
      const land = arrive + FLIGHT_DUR;
      litS[si] = Math.max(litS[si], easeOutCubic((t - start) / LIGHT_DUR));
      liftS[si] = Math.max(liftS[si], bell((t - start) / 0.9));
      litV[vi] = Math.max(litV[vi], easeOutCubic((t - arrive) / LIGHT_DUR));
      liftV[vi] = Math.max(liftV[vi], bell((t - arrive) / 0.8));
      flashV[vi] = Math.max(flashV[vi], bell((t - arrive) / FLASH_DUR));
      landed[i] = smootherstep((t - land) / RESULT_REVEAL_DUR);
      landFlash[i] = bell((t - land) / 0.8);

      // Spark along the wire.
      const curve = sparkCurves[i];
      const u = (t - start) / SPARK_DUR;
      for (let k = 0; k <= SPARK_TRAIL; k++) {
        const uk = easeInOut(u) - k * 0.035;
        const on = curve && u >= 0 && u <= 1.15 && uk > 0 && uk <= 1;
        const fade = 1 - k / (SPARK_TRAIL + 1);
        writeGlow(glowIndex++, on ? curve.getPointAt(Math.min(uk, 1), _v) : null, k === 0 ? 0.48 : 0.3 * fade, (k === 0 ? 1 : 0.5 * fade));
      }

      // Three cells fly from the matched pair to the result row.
      const fu = (t - arrive) / FLIGHT_DUR;
      for (let c = 0; c < PROJECTION.length; c++) {
        const flight = flights[i * PROJECTION.length + c];
        const active = t >= arrive && t < land + RESULT_REVEAL_DUR + FLIGHT_FADE_DUR;
        flight.group.visible = active;
        if (!active) continue;
        const e = smootherstep(fu);
        // Quadratic bezier through the control point.
        _v.copy(flight.from).multiplyScalar((1 - e) * (1 - e))
          .addScaledVector(flight.ctrl, 2 * (1 - e) * e)
          .addScaledVector(flight.to, e * e);
        flight.group.position.copy(_v);
        flight.group.rotation.set(0.25 * bell(e), 0, 0);
        // Keep the aligned cells opaque while the stationary row fades in
        // underneath; then dissolve them over identical destination pixels.
        const k = smootherstep(fu / 0.18) * (1 - smootherstep((t - land - RESULT_REVEAL_DUR) / FLIGHT_FADE_DUR));
        flight.face.opacity = k;
        flight.sides.opacity = k;
      }
    });
    screening.rows.forEach((slab, ri) => paintRow(slab, litS[ri], liftS[ri], 0, selecting));
    venue.rows.forEach((slab, ri) => paintRow(slab, litV[ri], liftV[ri], flashV[ri], selecting));

    // The result header settles before the first cells reach their row.
    const firstLand = smootherstep((t - T_PROJECT) / 0.7);
    result.cap.group.position.copy(result.cap.rest);
    result.cap.group.position.y -= (1 - firstLand) * 0.14;
    result.cap.group.position.z -= (1 - firstLand) * 0.18;
    setSlabOpacity(result.cap, firstLand);
    result.rows.forEach((slab, i) => {
      // A fixed landing surface prevents two copies of the text moving across
      // one another. The flying cells provide the row's entrance motion.
      slab.group.position.copy(slab.rest);
      setSlabOpacity(slab, landed[i]);
      slab.overlay.opacity = 0.22 * landFlash[i];
      _color.lerpColors(idleEdge, resultEdge, Math.min(1, landed[i] * (0.4 + 0.6 * landFlash[i])));
      slab.edge.color.copy(_color);
    });
    _color.lerpColors(idleEdge, resultEdge, 0.5 * firstLand);
    result.cap.edge.color.copy(_color);

    // Pulses circulate along the wire once the join is live.
    const pulseAlpha = t >= T_MATCH ? easeOutCubic((t - T_MATCH) / 0.6) : 0;
    for (let p = 0; p < PULSES; p++) {
      const head = ((t / PULSE_PERIOD) + p / PULSES) % 1;
      for (let k = 0; k <= TRAIL; k++) {
        const uk = head - k * 0.012;
        const fade = 1 - k / (TRAIL + 1);
        const ok = wireCurve && uk >= 0 && pulseAlpha > 0;
        writeGlow(p * (1 + TRAIL) + k, ok ? wireCurve!.getPointAt(uk, _v) : null, k === 0 ? 0.46 : 0.3 * fade, (k === 0 ? 1 : 0.5 * fade) * pulseAlpha);
      }
    }
    glowPos.needsUpdate = true;
    glowSize.needsUpdate = true;
    glowAlpha.needsUpdate = true;

    if (dust) dust.position.y = Math.sin(t * 0.21) * 0.12;

    // Camera: straight on. It eases in from slightly farther while the
    // tables rise, then rests; the pointer nudges it a little.
    const damp = 1 - Math.exp(-dt * 3.5);
    eased.x += (pointer.x - eased.x) * damp;
    eased.y += (pointer.y - eased.y) * damp;
    const sweep = easeOutCubic(t / 2.6);
    camTarget.copy(placement.target);
    camera.position.set(
      camTarget.x + eased.x * 0.3,
      camTarget.y - eased.y * 0.2 + (1 - sweep) * 0.3,
      baseDistance * (1.1 - 0.1 * sweep),
    );
    camera.lookAt(camTarget.x + eased.x * 0.1, camTarget.y - eased.y * 0.07, 0);
  }

  function render() {
    if (composer) composer.render();
    else renderer.render(scene, camera);
    if (!ready) { ready = true; opts.onReady(); }
  }

  function frame(now: number) {
    if (disposed || !running) return;
    try {
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      update(dt);
      render();
      if (time >= T_END) {
        // The sequence is complete: hold this frame and stop drawing.
        finished = true;
        running = false;
        opts.onComplete();
        return;
      }
      raf = requestAnimationFrame(frame);
    } catch (error) {
      console.error('[QueryTrace] The join scene could not render.', error);
      setRunning(false);
      opts.onFail();
    }
  }

  function setRunning(next: boolean) {
    if (disposed || finished || next === running) return;
    running = next;
    if (running) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    } else {
      cancelAnimationFrame(raf);
    }
  }

  function renderStill(seconds: number) {
    if (disposed) return;
    pointer.x = 0; pointer.y = 0; eased.x = 0; eased.y = 0;
    time = seconds;
    update(0, seconds);
    render();
  }

  const onLost = (event: Event) => {
    event.preventDefault();
    setRunning(false);
    opts.onFail();
  };
  canvas.addEventListener('webglcontextlost', onLost);

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    canvas.removeEventListener('webglcontextlost', onLost);
    disposeObject(scene);
    glow.dispose();
    bloom?.dispose();
    composer?.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }

  // Warm even the initially hidden materials before the animation clock starts,
  // using the same output color space as the actual scene pass.
  try {
    renderer.setRenderTarget(composer?.readBuffer ?? null);
    renderer.compile(scene, camera);
    renderer.setRenderTarget(null);
  } catch (error) {
    dispose();
    throw error;
  }

  return { setSize, setPointer, setRunning, renderStill, dispose };
}
