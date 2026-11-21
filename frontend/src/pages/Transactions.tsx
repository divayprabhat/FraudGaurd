import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { Button, Card, EmptyState, ErrorState, Page, RiskBadge, Segmented, Skeleton, cx } from '../components/ui';
import { SetupNotice, TransactionModal } from '../components/shared';
import { useApi } from '../lib/api';
import { actionLabel, dateTime, int, num, pct } from '../lib/format';
import type { Tx, TxPage } from '../lib/types';

const COLS: { key: string; label: string; sort?: string }[] = [
  { key: 'id', label: 'Transaction ID', sort: 'id' }, { key: 'amount', label: 'Amount', sort: 'amount' },
  { key: 'cat', label: 'Merchant category', sort: 'merchant_category' }, { key: 'ts', label: 'Scored live', sort: 'timestamp' },
  { key: 'p', label: 'Fraud probability', sort: 'fraud_probability' }, { key: 'risk', label: 'Risk level', sort: 'risk_level' }, { key: 'act', label: 'Action' },
];
const PAGE_SIZE = 10;

export default function Transactions() {
  const [sp, setSp] = useSearchParams();
  const q = sp.get('q') ?? '', risk = sp.get('risk') ?? 'ALL', sort = sp.get('sort') ?? 'timestamp', order = sp.get('order') ?? 'desc', page = Number(sp.get('page') ?? 1);
  const [text, setText] = useState(q);
  const [sel, setSel] = useState<Tx | null>(null);

  const set = (patch: Record<string, string | null>, resetPage = true) => {
    const n = new URLSearchParams(sp);
    Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k)));
    if (resetPage) n.delete('page');
    setSp(n, { replace: true });
  };
  useEffect(() => setText(q), [q]);
  useEffect(() => {
    if (text === q) return;
    const t = setTimeout(() => set({ q: text || null }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const qs = new URLSearchParams({ search: q, risk, sort, order, page: String(page), page_size: String(PAGE_SIZE) });
  const { data, error, loading, reload } = useApi<TxPage>(`/transactions?${qs}`);
  const sortBy = (s: string) => set(sort === s ? { order: order === 'asc' ? 'desc' : 'asc' } : { sort: s, order: 'desc' });

  if (error && !data) return <ErrorState message={error.message} onRetry={reload} />;
  const filtered = q || risk !== 'ALL';
  return (
    <Page>
      <SetupNotice />
      <Card pad={false}>
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input className="input pl-8" placeholder="Search ID, category or amount" value={text} onChange={(e) => setText(e.target.value)} aria-label="Search transactions" />
          </div>
          <Segmented label="Filter by risk" value={risk} onChange={(v) => set({ risk: v === 'ALL' ? null : v })}
            options={['ALL', 'LOW', 'MEDIUM', 'HIGH'].map((v) => ({ value: v, label: v === 'ALL' ? 'All' : v[0] + v.slice(1).toLowerCase() }))} />
        </div>
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full text-[13px]">
            <thead className="bg-raised/40"><tr>
              {COLS.map((c, i) => (
                <th key={c.key} className={cx('th', i === 0 && 'pl-5', i === COLS.length - 1 && 'pr-5')} aria-sort={c.sort === sort ? (order === 'asc' ? 'ascending' : 'descending') : undefined}>
                  {c.sort ? (
                    <button onClick={() => sortBy(c.sort!)} className={cx('inline-flex items-center gap-1 hover:text-fg', c.sort === sort && 'text-fg')}>
                      {c.label}{c.sort === sort ? (order === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={12} className="opacity-40" />}
                    </button>) : c.label}
                </th>))}
            </tr></thead>
            <tbody className="divide-y divide-line">
              {loading && !data ? Array.from({ length: 6 }).map((_, i) => <tr key={i}><td colSpan={7} className="p-3"><Skeleton className="h-6" /></td></tr>) :
                data?.items.map((t) => (
                  <tr key={t.id} onClick={() => setSel(t)} className="cursor-pointer hover:bg-raised/50" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setSel(t)}>
                    <td className="td pl-5 font-mono text-xs">{t.id}</td>
                    <td className="td tabular">{num(t.amount)}</td>
                    <td className="td text-muted">{t.merchant_category}</td>
                    <td className="td text-muted">{dateTime(t.timestamp)}</td>
                    <td className="td tabular">{pct(t.fraud_probability)}</td>
                    <td className="td"><RiskBadge risk={t.risk_level} /></td>
                    <td className="td pr-5 text-muted">{actionLabel(t.recommended_action)}</td>
                  </tr>))}
            </tbody>
          </table>
          {data && data.items.length === 0 && (
            <EmptyState title={filtered ? 'No matching transactions' : 'No transactions yet'}
              action={filtered ? <Button onClick={() => { setText(''); setSp({}, { replace: true }); }}>Clear filters</Button> : undefined}>
              {filtered ? 'Try a different search or risk filter.' : 'Load the trained model and held-out data, or analyze a transaction on the Fraud Detection page.'}
            </EmptyState>)}
        </div>
        {data && data.total > 0 && (
          <div className="flex items-center justify-between border-t border-line px-5 py-3 text-xs text-muted">
            <span className="tabular">{int((data.page - 1) * data.page_size + 1)}–{int(Math.min(data.page * data.page_size, data.total))} of {int(data.total)}</span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" className="h-8 w-8 !p-0" disabled={data.page <= 1} onClick={() => set({ page: String(data.page - 1) }, false)} aria-label="Previous page"><ChevronLeft size={16} /></Button>
              <span className="tabular px-2">Page {data.page} / {int(data.pages)}</span>
              <Button variant="ghost" className="h-8 w-8 !p-0" disabled={data.page >= data.pages} onClick={() => set({ page: String(data.page + 1) }, false)} aria-label="Next page"><ChevronRight size={16} /></Button>
            </div>
          </div>)}
      </Card>
      <p className="text-[11px] text-muted">The source dataset has no event times and none are invented: held-out transactions show a dash until the live replay scores them, and analysed ones show the time you analysed them.</p>
      <TransactionModal tx={sel} onClose={() => setSel(null)} />
    </Page>
  );
}
