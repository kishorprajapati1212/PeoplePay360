/** Small response helpers so every controller returns the same shape. */
export const ok = (res, data, status = 200) => res.status(status).json(data);
export const created = (res, data) => res.status(201).json(data);
export const noContent = (res) => res.status(204).end();
export const list = (res, r) => res.json({ rows: r.rows ?? r, total: r.total ?? (r.rows?.length ?? r.length),
  page: r.page, pages: r.pages, limit: r.limit, offset: r.offset });
/** snake_case query → camelCase service filters, dropping empties. */
export const filters = (q, map = {}) => {
  const out = {};
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === '' || v === null) continue;
    const key = map[k] || camel(k);
    if (v === 'true' || v === 'false') out[key] = v === 'true';
    else out[key] = v;
  }
  return out;
};
const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
export const bool = (v) => (v === undefined ? undefined : String(v) === 'true');
export const int = (v, d) => (v === undefined || v === '' ? d : Number(v));
export const streamPdf = (res, { buffer, fileName, sha256 }) => {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/"/g, '')}"`);
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('X-Pdf-Sha256', sha256 || '');
  res.end(buffer);
};
export const streamCsv = (res, { csv, name }) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.end(csv);
};
export const streamZip = (res, { buffer, fileName }) => {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Content-Length', buffer.length);
  res.end(buffer);
};
