/** Param builder used by every repository: `P(value)` pushes and returns "$n". */
export function params0() {
  const params = [];
  return {
    params,
    P: (v) => { params.push(v); return `$${params.length}`; },
    list: (arr) => arr.map((v) => { params.push(v); return `$${params.length}`; }).join(','),
  };
}
export const patchSql = (obj, keys, startIdx, allowed) => {
  const cols = keys.filter((k) => allowed.includes(k));
  return { sets: cols.map((c, i) => `${c} = $${startIdx + i}`).join(', '), values: cols.map((c) => obj[c]), cols };
};
export const has = (o, fields) => fields.some((f) => o[f] !== undefined);
