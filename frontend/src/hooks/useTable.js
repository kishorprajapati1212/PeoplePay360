import { useCallback, useMemo, useState } from 'react';
import { debounce } from '../utils/query.js';
import { PAGE_SIZE } from '../config/app.js';

/**
 * List-screen state: the search box, the filter selects, page/size and one sort column — turned into the
 * query string the backend list endpoints expect, and back into props the table can render.
 *
 * Sort cycles asc → desc → off, because a user who clicked twice wants to go back.
 */
export function useTable({ search = true, filters = {}, pageSize = PAGE_SIZE } = {}) {
  const [term, setTerm] = useState('');
  const [query, setQuery] = useState(() => (search ? { q: '' } : {}));
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(pageSize);
  const [sort, setSort] = useState(null);

  const push = useMemo(() => debounce((value) => { setQuery((q) => ({ ...q, q: value })); setPage(0); }), []);
  const onSearch = useCallback((value) => { setTerm(value); push(value); }, [push]);

  const onFilter = useCallback((key, value) => {
    setQuery((q) => ({ ...q, [key]: value === '' ? undefined : value }));
    setPage(0);
  }, []);

  const toggleSort = useCallback((column) => {
    if (!column) return;
    setSort((current) => (current?.by !== column ? { by: column, dir: 'asc' } : current.dir === 'asc' ? { by: column, dir: 'desc' } : null));
    setPage(0);
  }, []);

  // The API pages with 1-based `page` + `page_size`; a client-side list ignores both (zod strips them).
  const params = useMemo(() => ({
    ...query,
    page: page + 1,
    page_size: size,
    ...(sort ? { sort: sort.by, dir: sort.dir } : {}),
  }), [query, size, page, sort]);

  return {
    term, onSearch,
    query, onFilter,
    page, setPage, size, setSize,
    params, sort, toggleSort,
    reset: () => { setTerm(''); setQuery(search ? { q: '' } : {}); setPage(0); setSort(null); },
  };
}
