import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 14, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const PlayIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 4 14 8-14 8Z" fill="currentColor" stroke="none" />
  </Svg>
);

export const PauseIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x={5} y={4} width={4.5} height={16} rx={1} fill="currentColor" stroke="none" />
    <rect x={14.5} y={4} width={4.5} height={16} rx={1} fill="currentColor" stroke="none" />
  </Svg>
);

export const StepBackIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m15 18-6-6 6-6" />
  </Svg>
);

export const StepForwardIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m9 18 6-6-6-6" />
  </Svg>
);

export const ResetIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 12a9 9 0 1 0 2.64-6.36L3 8" />
    <path d="M3 3v5h5" />
  </Svg>
);

export const RunIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" fill="currentColor" stroke="none" />
  </Svg>
);

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Svg>
);

export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
);

/* --- stage icons -------------------------------------------------------- */

export const DatabaseIcon = (p: IconProps) => (
  <Svg {...p}>
    <ellipse cx={12} cy={5} rx={9} ry={3} />
    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" />
  </Svg>
);

export const JoinIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx={7.5} cy={12} r={5.5} />
    <circle cx={16.5} cy={12} r={5.5} />
  </Svg>
);

export const FilterIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3Z" />
  </Svg>
);

export const GroupIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m12 2 9 5.5-9 5.5-9-5.5L12 2Z" />
    <path d="m3 13 9 5.5 9-5.5" />
  </Svg>
);

export const HavingIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 3H4l6.5 8v7l3 2v-9L20 3Z" />
    <path d="m16 16 5 5m0-5-5 5" strokeWidth={1.75} />
  </Svg>
);

export const ColumnsIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x={3} y={3} width={18} height={18} rx={2} />
    <path d="M9 3v18M15 3v18" />
  </Svg>
);

export const SortIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m21 16-4 4-4-4M17 20V4M3 8l4-4 4 4M7 4v16" />
  </Svg>
);

/* --- schema badges ------------------------------------------------------ */

export const KeyIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx={8} cy={16} r={5} />
    <path d="m11.5 12.5 9-9M15 6l3 3" />
  </Svg>
);

export const LinkIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </Svg>
);

export const CrosshairIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx={12} cy={12} r={9} />
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
  </Svg>
);

export const BookIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15Z" />
    <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
  </Svg>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);

export const PanelLeftIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x={3} y={4} width={18} height={16} rx={2} />
    <path d="M9 4v16" />
  </Svg>
);

export const PanelRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x={3} y={4} width={18} height={16} rx={2} />
    <path d="M15 4v16" />
  </Svg>
);

export const HelpIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx={12} cy={12} r={9} />
    <path d="M9.2 9.2a2.8 2.8 0 1 1 3.9 2.6c-.8.35-1.1.9-1.1 1.9" />
    <path d="M12 17.2h.01" />
  </Svg>
);

export const InfoIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx={12} cy={12} r={9} />
    <path d="M12 11v5M12 7.5h.01" />
  </Svg>
);

export const TerminalIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m5 7 5 5-5 5" />
    <path d="M12 17h7" />
  </Svg>
);

export const TableIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x={3} y={4} width={18} height={16} rx={2} />
    <path d="M3 10h18M3 15h18M12 10v10" />
  </Svg>
);
