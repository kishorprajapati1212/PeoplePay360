/** The card from the mockup: title, tiny helper text, actions on the right. */
export function Panel({ title, subtitle, actions, children, className = '', pad = true }) {
  return (
    <section className={'panel ' + className}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 px-5 py-3.5">
          <div>
            {title && <h3 className="text-[13px] font-semibold tracking-tight text-slate-100">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      {title && <div aria-hidden className="border-t border-line/60" />}
      <div className={pad ? 'p-5' : ''}>{children}</div>
    </section>
  );
}
