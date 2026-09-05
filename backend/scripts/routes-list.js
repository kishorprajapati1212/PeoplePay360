#!/usr/bin/env node
/**
 * Route inventory — reads every path the Express router actually registers.
 * Used by `scripts/smoke.js` to prove each endpoint is exercised, and by the docs build.
 */
export async function routeList() {
  const { apiRouter } = await import('../src/routes/index.js');
  const prefixOf = (layer) => {
    let s = (layer.regexp?.source ?? '').replace(/^\^/, '').replace(/\\/g, '');
    s = s.replace(/\(\?=\S*\)$/, '').replace(/\$$/, '').replace(/\/\?$/, '');
    return s && s !== '/' ? `/${s.replace(/^\//, '')}` : '';
  };
  const out = [];
  const walk = (stack, prefix) => {
    for (const layer of stack) {
      if (layer.route) {
        const path = (prefix + (layer.route.path === '/' ? '' : layer.route.path)).replace(/\/$/, '');
        for (const m of Object.keys(layer.route.methods)) if (m !== 'head' && m !== 'options') out.push(`${m.toUpperCase()} ${path || '/'}`);
      } else if (layer.name === 'router' && layer.handle?.stack) walk(layer.handle.stack, prefix + prefixOf(layer));
    }
  };
  walk(apiRouter().stack, '/api');
  return [...new Set(out)].sort((a, b) => a.localeCompare(b));
}

if (process.argv[1] && process.argv[1].endsWith('routes-list.js')) {
  const list = await routeList();
  console.log(list.join('\n'));
  console.log(`TOTAL ${list.length}`);
  process.exit(0);
}
