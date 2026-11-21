import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Play, RotateCcw, Square, Radio } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button, Card, ChartTooltip, EmptyState, ErrorState, Notice, Page, Pill, RiskBadge, Skeleton, Stat, cx, riskColor } from '../components/ui';
import { SetupNotice } from '../components/shared';
import { api, useApi, ApiError } from '../lib/api';
import { useChartColors } from '../lib/theme';
import { useToast } from '../lib/toast';
import { int, ms, num, pct, time } from '../lib/format';
import type { Monitoring as M, Risk } from '../lib/types';

const healthTone = { healthy: 'bg-ok', warning: 'bg-warn', critical: 'bg-bad', idle: 'bg-muted' } as const;

export default function Monitoring() {
  const { data, error, loading, reload } = useApi<M>('/monitoring', { interval: 1500 });
  const c = useChartColors();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (a: 'start' | 'stop' | 'reset') => {
    setBusy(a);
    try {
      await api(`/monitoring/${a}`, { method: 'POST' });
      await reload();
      toast({ kind: 'info', title: { start: 'Simulation started', stop: 'Simulation stopped', reset: 'Session reset' }[a] });
    } catch (e) { toast({ kind: 'error', title: 'Action failed', message: (e as ApiError).message }); }
    finally { setBusy(null); }
  };

  if (error && !data) return <ErrorState message={error.message} onRetry={reload} />;
  const k = data?.kpis;
  const n = k?.transactions_processed ?? 0;
  const series = (data?.series ?? []).map((s) => ({ ...s, label: time(s.t), low: s.processed - s.high - s.medium }));
  const risks: [Risk, number][] = [['LOW', n - (k?.high_risk ?? 0) - (k?.medium_risk ?? 0)], ['MEDIUM', k?.medium_risk ?? 0], ['HIGH', k?.high_risk ?? 0]];
  const axis = { tick: { fill: c.axis, fontSize: 11 }, tickLine: false, axisLine: false } as const;

  return (
    <Page>
      <SetupNotice />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Pill tone="warn">SIMULATED</Pill>
          {data && <Pill tone={data.running ? 'ok' : 'muted'}><span className={cx('h-1.5 w-1.5 rounded-full', data.running ? 'animate-pulse bg-ok' : 'bg-muted')} />{data.running ? 'Running' : 'Stopped'}</Pill>}
        </div>
        <div className="flex items-center gap-2">
          {data?.running
            ? <Button onClick={() => act('stop')} loading={busy === 'stop'}><Square size={13} />Stop</Button>
            : <Button variant="primary" onClick={() => act('start')} loading={busy === 'start'} disabled={!data?.available}><Play size={13} />Start simulation</Button>}
          <Button variant="ghost" onClick={() => act('reset')} loading={busy === 'reset'} disabled={!data?.available || (n === 0 && !data?.running)}><RotateCcw size={14} />Reset</Button>
        </div>
      </div>
      <Notice tone="accent" title="Demo replay, not live banking data">
        {data?.description ?? 'Replays held-out test transactions through the trained model.'} Latency is measured around each real model call. Freshness is how long after its scheduled arrival an event finished scoring ({data?.target_events_per_second ?? '—'} events/s target), so it grows when scoring cannot keep up.
      </Notice>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {loading || !k ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[92px]" />) : (<>
          <Stat label="Transactions processed" value={int(n)} />
          <Stat label="High-risk" value={int(k.high_risk)} hint={n ? pct(k.high_risk / n) + ' of processed' : undefined} />
          <Stat label="Medium-risk" value={int(k.medium_risk)} hint={n ? pct(k.medium_risk / n) + ' of processed' : undefined} />
          <Stat label="Average latency" value={ms(k.mean_latency_ms)} />
          <Stat label="P95 latency" value={ms(k.p95_latency_ms)} />
          <Stat label="Throughput" value={k.throughput_eps == null ? '—' : `${num(k.throughput_eps, 1)}/s`} hint={k.scoring_capacity_eps ? `Replay-paced · capacity ≈ ${num(k.scoring_capacity_eps, 0)}/s` : 'Replay-paced'} />
        </>)}
      </div>

      {n === 0 ? (
        <Card><EmptyState icon={<Radio size={18} />} title="No events yet"
          action={data?.available ? <Button variant="primary" onClick={() => act('start')} loading={busy === 'start'}><Play size={13} />Start simulation</Button> : undefined}>
          {data?.available ? 'Start the simulation to replay held-out transactions through the model and populate these charts.' : 'The held-out replay data is not loaded. Put your dataset in backend/data/ and restart the API; it trains automatically.'}</EmptyState></Card>
      ) : (<>
        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-2" title="Transaction activity" subtitle="Events processed per second, by risk level">
            <div className="h-56"><ResponsiveContainer width="100%" height="100%">
              <BarChart data={series} margin={{ top: 4, right: 4, left: -16, bottom: 0 }} barCategoryGap={2}>
                <CartesianGrid stroke={c.grid} vertical={false} />
                <XAxis dataKey="label" {...axis} minTickGap={40} /><YAxis {...axis} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="low" name="Low" stackId="a" fill={c.accent} isAnimationActive={false} />
                <Bar dataKey="medium" name="Medium" stackId="a" fill={c.warn} isAnimationActive={false} />
                <Bar dataKey="high" name="High" stackId="a" fill={c.bad} isAnimationActive={false} />
              </BarChart></ResponsiveContainer></div>
          </Card>
          <Card title="Risk distribution" subtitle="This session">
            <ul className="space-y-4 pt-1">
              {risks.map(([r, v]) => (
                <li key={r}><div className="mb-1.5 flex items-center justify-between text-xs"><RiskBadge risk={r} /><span className="tabular text-muted">{int(v)} · {pct(v / Math.max(n, 1))}</span></div>
                  <div className="h-2 rounded-full bg-raised"><div className={cx('h-full rounded-full transition-all', riskColor[r])} style={{ width: `${(v / Math.max(n, 1)) * 100}%` }} /></div></li>))}
            </ul>
          </Card>
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-2" title="Processing latency" subtitle="Per-second average and p95, milliseconds">
            <div className="h-52"><ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                <CartesianGrid stroke={c.grid} vertical={false} />
                <XAxis dataKey="label" {...axis} minTickGap={40} /><YAxis {...axis} />
                <Tooltip content={<ChartTooltip fmt={(v) => ms(v)} />} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: c.axis }} />
                <Line type="monotone" dataKey="avg_latency_ms" name="Average" stroke={c.accent} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="p95_latency_ms" name="p95" stroke={c.warn} strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart></ResponsiveContainer></div>
          </Card>
          <Card title="System health">
            <ul className="space-y-3.5">
              {data?.health.map((h) => (
                <li key={h.name} className="flex items-start gap-3"><span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', healthTone[h.status])} />
                  <div className="min-w-0"><p className="font-medium">{h.name}</p><p className="truncate text-xs text-muted">{h.detail}</p></div></li>))}
            </ul>
            <p className="mt-4 border-t border-line pt-3 text-[11px] text-muted">Threshold breaches raise <Link to="/alerts" className="text-accent hover:underline">alerts</Link>.</p>
          </Card>
        </div>

        <Card pad={false} title="Live transaction feed" subtitle="Most recent scored events (simulated)">
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="border-y border-line bg-raised/40"><tr><th className="th pl-5">Time</th><th className="th">Transaction</th><th className="th">Amount</th><th className="th">Category</th><th className="th">Probability</th><th className="th">Latency</th><th className="th pr-5">Risk</th></tr></thead>
              <tbody className="divide-y divide-line">
                {data?.feed.slice(0, 12).map((e, i) => (
                  <tr key={`${e.transaction_id}-${e.processing_time_utc}-${i}`}>
                    <td className="td tabular pl-5 text-muted">{time(e.processing_time_utc)}</td><td className="td font-mono text-xs">{e.transaction_id}</td>
                    <td className="td tabular">{num(e.amount)}</td><td className="td text-muted">{e.merchant_category}</td>
                    <td className="td tabular">{pct(e.fraud_probability)}</td><td className="td tabular text-muted">{ms(e.latency_ms)}</td><td className="td pr-5"><RiskBadge risk={e.risk_level} /></td>
                  </tr>))}
              </tbody>
            </table>
          </div>
        </Card>
      </>)}
    </Page>
  );
}
