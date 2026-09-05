import { useTheme } from '../theme.js';

/**
 * The light/dark switch. It is a button, not a menu: two options, one click, remembered in localStorage.
 * Rendered in the sidebar footer and in the top bar (the top bar is the one that survives small screens).
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
        'inline-flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-[11px] font-medium text-slate-400 transition-colors hover:bg-ink-800 hover:text-slate-200 '
        + (compact ? '' : ' w-full')
      }
    >
      <span aria-hidden className="grid h-4 w-4 place-items-center text-[13px]">{theme === 'dark' ? '☾' : '☀'}</span>
      {!compact && <span>{theme === 'dark' ? 'Dark theme' : 'Light theme'}</span>}
    </button>
  );
}
