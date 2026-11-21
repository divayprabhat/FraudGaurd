import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BellOff, Check, CheckCheck } from 'lucide-react';
import { Button, Card, EmptyState, ErrorState, Page, Pill, Segmented, Skeleton } from '../components/ui';
import { api, useApi, ApiError } from '../lib/api';
import { useToast } from '../lib/toast';
import { dateTime } from '../lib/format';
import type { Alert, AlertsResponse } from '../lib/types';

const statusTone = { open: 'bad', acknowledged: 'warn', resolved: 'ok' } as const;

export default function Alerts() {
  const { data, error, loading, reload } = useApi<AlertsResponse>('/alerts', { interval: 3000 });
  const toast = useToast();
  const [status, setStatus] = useState<'all' | Alert['status']>('all');
  const [sev, setSev] = useState<'all' | Alert['severity']>('all');
  const [busy, setBusy] = useState<string | null>(null);

  const update = async (a: Alert, s: Alert['status']) => {
    setBusy(a.id);
    try { await api(`/alerts/${a.id}`, { method: 'PATCH', body: JSON.stringify({ status: s }) }); await reload(); toast({ kind: 'success', title: `Alert ${s}`, message: a.type }); }
    catch (e) { toast({ kind: 'error', title: 'Update failed', message: (e as ApiError).message }); }
    finally { setBusy(null); }
  };

  if (error && !data) return <ErrorState message={error.message} onRetry={reload} />;
  const items = (data?.items ?? []).filter((a) => (status === 'all' || a.status === status) && (sev === 'all' || a.severity === sev));
  return (
    <Page>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented label="Status" value={status} onChange={setStatus} options={[
          { value: 'all', label: 'All' }, { value: 'open', label: `Open${data ? ` · ${data.counts.open}` : ''}` },
          { value: 'acknowledged', label: `Acknowledged${data ? ` · ${data.counts.acknowledged}` : ''}` }, { value: 'resolved', label: `Resolved${data ? ` · ${data.counts.resolved}` : ''}` }]} />
        <Segmented label="Severity" value={sev} onChange={setSev} options={[{ value: 'all', label: 'Any severity' }, { value: 'warning', label: 'Warning' }, { value: 'critical', label: 'Critical' }]} />
      </div>
      <Card pad={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-raised/40"><tr><th className="th pl-5">Alert type</th><th className="th">Severity</th><th className="th">Description</th><th className="th">Timestamp</th><th className="th">Status</th><th className="th pr-5 text-right">Actions</th></tr></thead>
            <tbody className="divide-y divide-line">
              {loading && !data ? Array.from({ length: 4 }).map((_, i) => <tr key={i}><td colSpan={6} className="p-3"><Skeleton className="h-6" /></td></tr>) : items.map((a) => (
                <tr key={a.id} className="align-top">
                  <td className="td pl-5 font-medium">{a.type}</td>
                  <td className="td"><Pill tone={a.severity === 'critical' ? 'bad' : 'warn'}>{a.severity === 'critical' ? 'Critical' : 'Warning'}</Pill></td>
                  <td className="px-4 py-3 text-muted"><p className="min-w-[260px] max-w-md whitespace-normal">{a.description}</p></td>
                  <td className="td text-muted">{dateTime(a.timestamp)}</td>
                  <td className="td"><Pill tone={statusTone[a.status]}>{a.status[0].toUpperCase() + a.status.slice(1)}</Pill></td>
                  <td className="td pr-5 text-right">
                    <div className="inline-flex gap-1.5">
                      {a.status === 'open' && <Button className="h-8 text-xs" loading={busy === a.id} onClick={() => update(a, 'acknowledged')}><Check size={13} />Acknowledge</Button>}
                      {a.status !== 'resolved' && <Button className="h-8 text-xs" disabled={busy === a.id} onClick={() => update(a, 'resolved')}><CheckCheck size={13} />Resolve</Button>}
                    </div>
                  </td>
                </tr>))}
            </tbody>
          </table>
          {data && items.length === 0 && (
            <EmptyState icon={<BellOff size={18} />} title={data.items.length ? 'No alerts match these filters' : 'No alerts'}
              action={!data.items.length ? <Link to="/monitoring"><Button>Go to Live Monitoring</Button></Link> : undefined}>
              {data.items.length ? 'Adjust the status or severity filter.' : 'Alerts are raised when the simulated replay breaches a notebook threshold (predicted fraud rate, p95 latency, freshness SLA) or a transaction scores HIGH risk.'}
            </EmptyState>)}
        </div>
      </Card>
    </Page>
  );
}
