import { MATCHES, SCREENING, VENUE, type TableSpec } from './joinData';
import s from '../landing.module.css';

export const STATIC_JOIN_DESCRIPTION =
  'SCREENING and VENUE joined on VENUE_ID. All six screenings match a venue. The result contains venue name, film title and screening day, including Paper Moons at Beacon Theater on Friday.';

const RESULT: TableSpec = {
  name: 'RESULT',
  columns: [VENUE.columns[1], SCREENING.columns[1], SCREENING.columns[3]],
  rows: MATCHES.map(([screening, venue]) => [VENUE.rows[venue][1], SCREENING.rows[screening][1], SCREENING.rows[screening][3]]),
  keyColumn: -1,
};

const TITLE_HEIGHT = 28;
const HEADER_HEIGHT = 28;
const ROW_HEIGHT = 21;

interface TableCardProps {
  table: TableSpec;
  x: number;
  y: number;
  widths: number[];
  /** Compact layouts keep the join key and the query's selected columns. */
  columns?: number[];
  selected: number[];
}

function TableCard({ table, x, y, widths, columns = table.columns.map((_, i) => i), selected }: TableCardProps) {
  const width = widths.reduce((sum, value) => sum + value, 0);
  const bodyTop = TITLE_HEIGHT + HEADER_HEIGHT;
  const height = bodyTop + table.rows.length * ROW_HEIGHT;
  const result = table === RESULT;
  const edge = result ? 'var(--mint)' : 'var(--accent)';
  let offset = 0;
  const cells = columns.map((index, i) => {
    const cell = { index, left: offset, width: widths[i] };
    offset += widths[i];
    return cell;
  });

  return (
    <g transform={`translate(${x} ${y})`} data-table={table.name}>
      <rect width={width} height={height} fill="var(--bg-node)" stroke={edge} strokeWidth="1.5" />
      <rect x="1" y="1" width={width - 2} height={TITLE_HEIGHT - 1} fill="var(--bg-node-header)" />
      <text x="10" y="18" className={s.staticTableName}>{table.name}</text>
      <text x={width - 10} y="18" textAnchor="end" className={s.staticRowCount}>{table.rows.length} rows</text>
      {cells.map(({ index, left, width: cellWidth }) => {
        const color = selected.includes(index) ? 'var(--mint)' : index === table.keyColumn ? 'var(--accent)' : 'var(--soft)';
        return (
          <g key={index}>
            <rect x={left + 1} y={TITLE_HEIGHT} width={cellWidth - 2} height={HEADER_HEIGHT} fill={color} opacity="0.1" />
            <text x={left + 8} y={TITLE_HEIGHT + 18} fill={color} className={s.staticColumn}>{table.columns[index].name}</text>
          </g>
        );
      })}
      {table.rows.map((row, ri) => (
        <g key={ri} transform={`translate(0 ${bodyTop + ri * ROW_HEIGHT})`} data-row={ri}>
          <rect x="1" width={width - 2} height={ROW_HEIGHT} fill={ri % 2 ? 'var(--bg-row-alt)' : 'transparent'} />
          <path d={`M1 ${ROW_HEIGHT} H${width - 1}`} stroke="var(--border-default)" strokeWidth="0.7" />
          <rect x="1" y="2" width="3" height={ROW_HEIGHT - 4} fill={edge} opacity="0.7" />
          {cells.map(({ index, left }) => (
            <text key={index} x={left + 8} y="14" className={s.staticCell}>{row[index]}</text>
          ))}
        </g>
      ))}
    </g>
  );
}

/** A vector rendering of the same join: no image download, WebGL or three.js. */
export function StaticJoin() {
  return (
    <div className={s.staticJoin} data-testid="hero-static-join" aria-hidden="true">
      <svg className={s.staticLandscape} viewBox="0 0 1200 720" focusable="false">
        <path d="M410.5 387 V418 H735 V445" className={s.staticWire} />
        <path d="m730 442 5 8 5-8Z" fill="var(--accent)" />
        <TableCard table={SCREENING} x={70} y={205} widths={[98, 200, 85, 137, 100]} selected={[1, 3]} />
        <TableCard table={VENUE} x={700} y={450} widths={[70, 152, 130, 78]} selected={[1]} />
        <TableCard table={RESULT} x={700} y={125} widths={[155, 170, 105]} selected={[0, 1, 2]} />
      </svg>
      <svg className={s.staticPortrait} viewBox="0 0 400 690" focusable="false">
        <path d="M52 210 V232 H132 V250" className={s.staticWire} />
        <path d="m127 247 5 8 5-8Z" fill="var(--accent)" />
        <path d="M320 416 V473" className={`${s.staticWire} ${s.staticResultWire}`} />
        <path d="m315 470 5 8 5-8Z" fill="var(--mint)" />
        <TableCard table={SCREENING} x={20} y={28} widths={[64, 185, 111]} columns={[2, 1, 3]} selected={[1, 3]} />
        <TableCard table={VENUE} x={100} y={255} widths={[64, 216]} columns={[0, 1]} selected={[1]} />
        <TableCard table={RESULT} x={20} y={478} widths={[119, 148, 93]} selected={[0, 1, 2]} />
      </svg>
    </div>
  );
}
