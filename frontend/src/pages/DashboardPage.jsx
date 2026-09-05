import { DASHBOARD_KINDS, dashboardEntry, dashboardKindFor } from './dashboards/registry.js';
import { useAuth } from '../auth/useAuth.js';
import { Panel } from '../components/ui/Panel.jsx';

/**
 * The dashboard switchboard.
 *
 * It used to be one component with a `mode` prop and two `mode === 'payroll'` conditions inside it: a third
 * dashboard meant editing that component, and editing one condition instead of two gave a screen with the
 * wrong title and no error. Now `kind` (from the route, or picked from the caller's own permissions) is a
 * lookup in dashboards/registry.js, and every difference between two dashboards lives in their own entry.
 *
 * An unknown kind is a visible message that lists what is registered, never a crash — the case the review
 * asked about ("if in future there is a new dashboard then it will give error").
 */
export function DashboardPage({ kind, mode }) {
  const { user } = useAuth();
  const wanted = kind || mode;                          // `mode` is still accepted: old links keep working
  // An explicit kind that is not registered is reported, not quietly swapped for something else: a route
  // that was renamed or half-added should be visible, and a silent substitute is how a wrong dashboard
  // gets shipped. Only the absence of a kind falls back to what the user's permissions say.
  const entry = wanted ? dashboardEntry(wanted) : dashboardEntry(dashboardKindFor(user));

  if (!entry) {
    return (
      <Panel title="This dashboard is not registered" pad>
        <p className="text-sm text-slate-300">
          <code className="text-brand-300">{String(wanted)}</code> is not one of the dashboards this build knows about.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Registered: {DASHBOARD_KINDS.map((k) => k.key).join(', ')}. To add one, put an entry in
          <code className="mx-1 text-slate-300">frontend/src/pages/dashboards/registry.js</code>
          with a `when` predicate and a component — nothing in this file has to change.
        </p>
      </Panel>
    );
  }

  if (!user && !wanted) {
    return <Panel title="Loading your dashboard" pad><p className="text-sm text-slate-400">Asking the API which screen your role gets — the choice comes from your permissions, not from a hard-coded list.</p></Panel>;
  }
  const { Component, ...rest } = entry;
  return <Component entry={rest} />;
}

export { DASHBOARD_KINDS, dashboardKindFor };
