export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-line">
      {tabs.map((tab) => (
        <button key={tab.key}
                onClick={() => onChange(tab.key)}
                className={
                  '-mb-px border-b-2 px-3 py-2 text-sm transition-colors ' +
                  (active === tab.key ? 'border-brand-500 text-slate-100' : 'border-transparent text-slate-400 hover:text-slate-200')
                }>
          {tab.label}
          {tab.count !== undefined && <span className="ml-1.5 text-xs text-slate-500">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}
