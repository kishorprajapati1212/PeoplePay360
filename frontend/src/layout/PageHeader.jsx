/** Title + one-line explanation + the actions a screen offers, above every page. */
export function PageHeader({ title, subtitle, actions, back }) {
  return (
    /* One row, centred vertically: title on the left, the page's buttons on the right, and both sit on the
       same px-4 rhythm as the panel below so nothing looks nudged sideways. */
    <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        {back && <a className="text-xs text-slate-400 hover:text-slate-200" href={back}>← back</a>}
        <h1 className="truncate text-lg font-semibold tracking-tight text-slate-100">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
