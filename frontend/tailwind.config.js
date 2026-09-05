/** Tailwind is configured by hand (no CLI init) — these are the only tokens the app uses. */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: { 950: '#080d16', 900: '#0b1220', 850: '#0f1828', 800: '#131f33', 700: '#1c2b44', 600: '#2a3d5c' },
        line: '#1e2c45',
        brand: { 50: '#eef2ff', 200: '#c7d2fe', 300: '#a5b4fc', 400: '#818cf8', 500: '#6366f1', 600: '#4f46e5', 700: '#4338ca' },
        good: '#22c55e',
        warn: '#f59e0b',
        bad: '#ef4444',
      },
      fontFamily: { sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'] },
      boxShadow: { panel: '0 1px 0 0 rgba(255,255,255,.03) inset, 0 12px 30px -18px rgba(0,0,0,.8)' },
    },
  },
  plugins: [],
};
