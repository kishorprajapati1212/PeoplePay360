import { PageHeader } from '../../layout/PageHeader.jsx';
import { Panel } from '../../components/ui/Panel.jsx';
import { Spinner } from '../../components/ui/Spinner.jsx';
import { useAccessMatrix } from '../../rbac/permissions.js';

/**
 * Read-only view of the single access-control table. Editing happens in
 * backend/src/lib/shared/permissions.js (ROLE_PERMISSIONS) — this screen exists so a reviewer can see
 * what each role means without reading code, and so the API and the UI can never disagree.
 */
export function AccessPage() {
  const { data, error } = useAccessMatrix();
  if (error) return <p className="text-sm text-red-300">{error}</p>;
  if (!data) return <Spinner label="Loading the access matrix…" />;

  const roles = data.roles || Object.keys(data.matrix || {});
  const permissions = data.permissions || [];

  return (
    <>
      <PageHeader title="Access matrix" subtitle="What each permission means, and which roles hold it."
                  actions={<span className="chip border-line bg-ink-800 text-slate-400">edit in one file</span>} />
      <Panel pad={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-ink-850/60">
              <tr>
                <th className="th">Permission</th>
                {roles.map((r) => <th key={r} className="th text-center">{r}</th>)}
              </tr>
            </thead>
            <tbody>
              {permissions.map((p) => (
                <tr key={p.key || p} className="row">
                  <td className="td">
                    <code className="text-brand-200">{p.key || p}</code>
                    {p.label && <p className="mt-0.5 text-xs text-slate-500">{p.label}{p.desc ? ' — ' + p.desc : ''}</p>}
                  </td>
                  {roles.map((r) => (
                    <td key={r} className="td text-center">
                      {cellFor(data, p.key || p, r) === 'yes'
                        ? <span className="chip border-emerald-500/30 bg-emerald-500/10 text-emerald-300">✓</span>
                        : cellFor(data, p.key || p, r) === 'star'
                        ? <span className="chip border-brand-500/30 bg-brand-500/10 text-brand-200">all</span>
                        : <span className="text-slate-500">·</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

/** The API may answer as { matrix: { ROLE: [perm] } } or { roles: [{ role, permissions: [] }] } — handle both. */
function cellFor(data, perm, role) {
  const list = data.matrix?.[role] || (data.roles || []).find?.((r) => (r.role || r.key || r.name) === role)?.permissions || [];
  if (list.includes('*')) return 'star';
  return list.includes(perm) ? 'yes' : 'no';
}
