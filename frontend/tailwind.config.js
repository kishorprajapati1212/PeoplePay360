/**
 * Tailwind is configured by hand (no CLI init) — these are the only tokens the app uses.
 *
 * Every colour points at a variable defined in src/theme.css instead of a literal hex. That is the whole
 * light/dark mechanism: `bg-ink-900` is one class everywhere, and the variable behind `--ink-900` is a
 * different colour under html.dark than under html.light, so nothing in src/pages mentions the theme.
 * The `rgb(… / <alpha-value>)` form is what keeps modifiers like `bg-ink-800/60` working.
 */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
const ramp = (family, shades) => Object.fromEntries(shades.map((s) => [s, v(`${family}-${s}`)]));

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class', // html.dark / html.light — set by src/theme.js
  theme: {
    extend: {
      colors: {
        ink: ramp('ink', [950, 900, 850, 800, 700, 600]),
        line: { DEFAULT: v('line') },
        brand: { ...ramp('brand', SHADES), DEFAULT: v('brand-500') },
        good: { DEFAULT: v('good') },
        warn: { DEFAULT: v('warn') },
        bad: { DEFAULT: v('bad') },
        slate: ramp('slate', SHADES),
        emerald: ramp('emerald', SHADES),
        amber: ramp('amber', SHADES),
        red: ramp('red', SHADES),
        sky: ramp('sky', SHADES),
      },
      fontFamily: { sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'] },
      boxShadow: { panel: 'var(--panel-shadow)' },
    },
  },
  plugins: [],
};
