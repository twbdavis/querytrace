import type { Config } from 'tailwindcss';
import { accents, lines, surfaces, text } from './styles/theme';

/** hex -> `rgb(r g b / <alpha-value>)` so slash-opacity modifiers work. */
function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255} / <alpha-value>)`;
}

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        app: rgb(surfaces.app),
        canvas: rgb(surfaces.canvas),
        node: { DEFAULT: rgb(surfaces.node), header: rgb(surfaces.nodeHeader) },
        panel: rgb(surfaces.panel),
        // Already an alpha overlay - no slash-opacity support needed for zebra.
        'row-alt': surfaces.rowAlt,
        line: { DEFAULT: rgb(lines.default), strong: rgb(lines.strong) },
        ink: { DEFAULT: rgb(text.primary), dim: rgb(text.secondary), mute: rgb(text.muted) },
        accent: {
          active: rgb(accents.active),
          pulse: rgb(accents.pulse),
          filter: rgb(accents.filter),
          group: rgb(accents.group),
          result: rgb(accents.result),
          error: rgb(accents.error),
        },
      },
      fontFamily: {
        ui: ['var(--font-ui)', 'system-ui', 'sans-serif'],
        data: ['var(--font-data)', 'ui-monospace', 'monospace'],
      },
      keyframes: {
        'bus-flow': {
          to: { 'stroke-dashoffset': '-14' },
        },
      },
      animation: {
        'bus-flow': 'bus-flow 0.9s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
