import { useEffect, useState } from 'react';
import { auth } from '../api/endpoints.js';

/**
 * Access control in the UI has exactly one source of truth: the permission list the API returns from
 * GET /api/auth/me, which the backend computes from ROLE_PERMISSIONS in
 * backend/src/lib/shared/permissions.js. Changing that file changes what this app shows — no
 * duplicated role table lives here.
 *
 * What this file owns: how a permission key is *rendered* (labels, icons, fallback copy).
 */

/** Icon per nav key, so the sidebar can stay a one-liner. Mirrors the mockup's module order. */
export const NAV_ICONS = {
  dashboard: 'LayoutDashboard', portal: 'UserCircle', employees: 'Users', contracts: 'FileText',
  attendance: 'Clock', timeoff: 'CalendarDays', payroll: 'Banknote', payslips: 'FileSpreadsheet',
  payruns: 'Receipt', salary: 'SlidersHorizontal', settings: 'Settings', users: 'ShieldCheck',
  access: 'KeyRound', system: 'Activity', holiday: 'PartyPopper', schedule: 'CalendarClock',
  departments: 'Building2', audit: 'ScrollText',
};

/** A page may need a permission the menu does not carry — this maps screen → what it requires. */
export const PAGE_PERMISSIONS = {
  '/dashboard': 'dashboard:hr',
  '/payroll': 'dashboard:payroll',
  '/employees': 'employee:read',
  '/departments': 'department:read',
  '/working-schedules': 'schedule:read',
  '/holidays': 'holiday:read',
  '/contracts': 'contract:read',
  '/attendance': 'attendance:read',
  '/time-off': 'timeoff:type_read',
  '/time-off/requests': 'timeoff:approve',
  '/time-off/types': 'timeoff:type_read',
  '/time-off/allocations': 'timeoff:allocation_read',
  '/time-off/my-requests': 'timeoff:read_own',
  '/payruns': 'payroll:payrun_read',
  '/payslips': 'payslip:read_all',
  '/salary/structures': 'salary:structure_read',
  '/salary/rules': 'salary:rule_read',
  '/company': 'settings:read',
  '/users': 'user:read',
  '/access': 'user:read',
  '/system': 'system:queue',
  '/portal': 'profile:read',
  '/portal/payslips': 'payslip:read_own',
};

/** The one predicate every component uses. Admin gets '*' from the API, so everything matches. */
export function can(user, permission, { anyOf = false } = {}) {
  if (!permission) return true;
  if (!user) return false;
  const list = user.permissions || [];
  if (list.includes('*')) return true;
  const keys = Array.isArray(permission) ? permission : [permission];
  const hit = (key) => list.includes(key) || (key.endsWith(':write') && list.includes(key.replace(':write', ':create')));
  return anyOf ? keys.some(hit) : keys.every(hit);
}

/** Read/write pair for the CRUD screens: the list needs read, the buttons need write. */
export function crudPerms(read, write) { return { read, write }; }

/**
 * Backend nav (menus) filtered against the current user — used by the sidebar.
 * A parent with children disappears when none of its children survived the filter.
 */
export function visibleNav(user) {
  return (user?.menus || [])
    .map((item) => ({ ...item, children: (item.children || []).filter((child) => can(user, child.perm)) }))
    .filter((item) => can(user, item.perm) && (!item.children?.length || item.children.length > 0));
}

/** The catalogue behind the Access screen — fetched, never hard-coded. */
export function useAccessMatrix() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { auth.accessMatrix().then(setData).catch((e) => setError(e.message)); }, []);
  return { data, error };
}
