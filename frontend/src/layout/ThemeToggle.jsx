import { useTheme } from '../theme.js';

/**
 * The light/dark switch. It is a button, not a menu: two options, one click, remembered in localStorage.
 * Rendered in the sidebar footer, in the top bar (the one that survives small screens) and, compact, on the
 * two signed-out screens — signing in and choosing a password are part of the product too, so they are read
 * in whichever theme the rest of the app was left in.
 */
export function ThemeToggle({ compact = false }) {
  const { theme, toggle } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      title={`Switch to the ${next} theme`}
      aria-label={`Switch to the ${next} theme`}
      className={
        'inline-flex items-center gap-2.5 rounded-xl border border-line bg-ink-850/40 px-2.5 py-2 text-[11px] font-medium text-slate-400 transition-colors hover:bg-ink-800 hover:text-slate-200 '
        + (compact ? '' : ' w-full')
      }
    >
      <span aria-hidden className="grid h-4 w-4 place-items-center">
        {theme === 'dark'
          ? <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" /></svg>
          : <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4.5" /><path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M4.9 4.9 6.7 6.7M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" /></svg>}
      </span>
      {!compact && <span>{theme === 'dark' ? 'Dark theme' : 'Light theme'}</span>}
    </button>
  );
}
