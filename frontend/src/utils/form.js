/**
 * The one rule every form here follows: a field the API will refuse must be marked with * and must complain in
 * its own box before the request is sent — never only as a red toast afterwards.
 *
 * CRUD screens already get this from `components/crud/schemaForm.jsx` (`fieldProblems` runs over the field
 * spec, and the star comes from the same `required` flag). The dialogs that are hand-written — assign a balance,
 * raise leave on someone's behalf, a working week, a contract — use the helpers below so they cannot drift into
 * the half-checked state that made people ask "why is there no star on that one".
 *
 * The list of required keys is not a guess: it is what the validator in
 * `backend/src/validators/*.schema.js` answers when it is given `{}`.
 */

export const isBlank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/**
 * `guard(values, spec)` → `{ problems, missing, ok }`.
 *
 * `spec` is `[[key, label]]` for a field that is always needed, or `[[key, label, false]]` to describe one that
 * is not (a conditional check can then override it). Naming a field here at all means "needed", which is the
 * common case in a dialog with three boxes; a CRUD form instead carries `required` on the field itself and gets
 * the same sentence from `fieldProblems` in components/crud/schemaForm.jsx.
 */
export function guard(values, spec) {
  const problems = {};
  const missing = [];
  for (const [key, label, required = true] of spec) {
    if (!required) continue;             // marked optional: never a complaint
    if (!isBlank(values[key])) continue; // filled: nothing to say
    problems[key] = `${label} is needed`;
    missing.push(label);
  }
  return { problems, missing, ok: missing.length === 0 };
}

/** What the top of a dialog says when something is missing — one sentence, every field named. */
export function missingSentence(missing) {
  if (!missing.length) return null;
  const names = missing.length === 1 ? missing[0]
    : missing.slice(0, -1).join(', ') + ' and ' + missing[missing.length - 1];
  return `Before this can be saved: ${names} ${missing.length === 1 ? 'is' : 'are'} needed.`;
}
