import { useSyncExternalStore } from 'react';

/**
 * The whole theme in one file: two palettes, one class on <html>, one localStorage key.
 *
 * How the recolouring actually works: `src/theme.css` defines every colour the app uses as a CSS variable
 * (twice — once under `.dark`, once under `.light`), and `tailwind.config.js` points each colour utility at
 * one of those variables. So toggling the class repaints every screen, including the ones that never import
 * this file. The exception is the dashboard chart: SVG props take literal colours, not classes, so it reads
 * `palette` from this module instead — that is the only component that has to care.
 */
const KEY = 'pp360.theme';
const listeners = new Set();

const PALETTE = {
  dark: { grid: '#1e2c45', axis: '#64748b', gross: '#6366f1', net: '#22c55e', brandSoft: '#818cf8', warn: '#f59e0b', bad: '#ef4444', surface: '#0f1828', text: '#e2e8f0' },
  /* The light palette is off-white paper (theme.css `html.light`), so the chart is drawn on the same panel
     colour as the card around it. These are literal colours because SVG props cannot read a CSS variable. */
  light: { grid: '#e5e0d5', axis: '#6f6862', gross: '#4f46e5', net: '#059669', brandSoft: '#818cf8', warn: '#b45309', bad: '#dc2626', surface: '#fdfcfa', text: '#3a3631' },
};

export function current() {
  if (typeof localStorage === 'undefined') return 'dark';
  const saved = localStorage.getItem(KEY);
  return saved === 'light' || saved === 'dark' ? saved : 'dark';
}

function paint(theme) {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.classList.toggle('light', theme === 'light');
  root.style.colorScheme = theme; // native inputs, scrollbars and form controls follow the theme
  return theme;
}

export function set(theme) {
  paint(theme);
  localStorage.setItem(KEY, theme);
  listeners.forEach((fire) => fire());
  return theme;
}

export function toggle() { set(current() === 'dark' ? 'light' : 'dark'); }

/** index.html calls this before React mounts, so a reload never flashes the wrong theme. */
export function restore() { paint(current()); }

function subscribe(fire) {
  listeners.add(fire);
  return () => listeners.delete(fire);
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, current, () => 'dark');
  return { theme, set, toggle, palette: PALETTE[theme] || PALETTE.dark };
}
