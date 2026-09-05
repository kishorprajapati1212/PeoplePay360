export function Spinner({ label, fullscreen = false }) {
  const box = (
    <div className="flex items-center gap-3 text-sm text-slate-400">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-brand-400" />
      {label && <span>{label}</span>}
    </div>
  );
  if (!fullscreen) return box;
  return <div className="flex h-full min-h-[60vh] items-center justify-center">{box}</div>;
}
