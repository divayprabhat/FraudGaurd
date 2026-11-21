import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ArrowRight, CheckCircle2, Target, Timer, ShieldAlert } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, ChartTooltip, EmptyState, ErrorState, Notice, Page, Pill, RiskBadge, Skeleton, Stat } from '../components/ui';
import { SetupNotice, TransactionModal, useHealth } from '../components/shared';
import { useApi } from '../lib/api';
import { useChartColors } from '../lib/theme';
import { int, ms, num, pct, dateTime } from '../lib/format';
import type { Dashboard, Tx } from '../lib/types';

export default function Overview() {
  const { data, error, loading, reload } = useApi<Dashboard>('/dashboard', { interval: 15000 });
  const c = useChartColors();
  const [sel, setSel] = useState<Tx | null>(null);
  const { health } = useHealth();
  const [updated, setUpdated] = useState<Date | null>(null);
  useEffect(() => { if (data) setUpdated(new Date()); }, [data]);

  if (error && !data) return <ErrorState message={error.message} onRetry={reload} />;
  const k = data?.kpis;
  const has = !!data?.available;
  const src = data?.evaluation_source === 'recomputed' ? 'test split at training time, not live' : 'notebook test split, not live';

  return (
    <Page>
      <SetupNotice />
      {health?.synthetic_demo_data && (
        <Notice title="This model was trained on synthetic demo data">Every number here is computed for real, but from generated data with weak fraud signal, so accuracy and detection figures are illustrative. Replace backend/data/credit_card_fraud_10k.csv with your real dataset and restart to retrain.</Notice>)}
      <div className="hero-strip card flex flex-wrap items-center justify-between gap-4 px-5 py-4">
        <div><p className="text-xs text-muted">Active model</p>
          <p className="text-lg font-semibold tracking-tight"><span className="text-gradient">{health?.model_name ?? '—'}</span> <span className="text-sm font-normal text-muted">{health?.model_version ?? ''}</span></p></div>
        <div className="flex flex-wrap items-center gap-2">
          {health && <Pill tone="accent">Threshold {health.threshold.toFixed(2)}</Pill>}
          {health && <Pill tone={health.synthetic_demo_data ? 'warn' : 'ok'}>{health.synthetic_demo_data ? 'Synthetic data' : 'Your dataset'}</Pill>}
          {updated && <span className="flex items-center gap-2 pl-1 text-xs text-muted"><span className="live-dot" />Updated {updated.toLocaleTimeString(undefined, { hour12: false })}</span>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {loading || !k ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[98px]" />) : (<>
          <Stat label="Total transactions" icon={<Activity size={15} />} value={int(k.total_transactions)} hint="Held-out set + manual analyses" />
          <Stat label="Flagged as fraud" icon={<ShieldAlert size={15} />} value={int(k.flagged_fraud)} hint={`${int(k.confirmed_fraud_labels)} labelled fraud in data`} />
          <Stat label="Fraud detection rate" icon={<Target size={15} />} value={pct(k.detection_rate)} hint={`Recall · ${src}`} />
          <Stat label="Model accuracy" icon={<CheckCircle2 size={15} />} value={pct(k.accuracy, 2)} hint={`Accuracy · ${src}`} />
          <Stat label="Avg processing latency" icon={<Timer size={15} />} value={ms(k.avg_latency_ms)} hint={`${k.latency_source} · ${k.latency_samples} scorings`} />
        </>)}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Transaction activity by hour" subtitle="Transactions and model-flagged fraud, by the transaction_hour feature">
          {!has ? <EmptyState title="No transactions yet">Train the model to load the held-out transaction set.</EmptyState> : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data!.activity_by_hour} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <defs><linearGradient id="gA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={c.accent} stopOpacity={0.25} /><stop offset="1" stopColor={c.accent} stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid stroke={c.grid} vertical={false} />
                  <XAxis dataKey="hour" tick={{ fill: c.axis, fontSize: 11 }} tickLine={false} axisLine={{ stroke: c.grid }} tickFormatter={(h) => String(h).padStart(2, '0')} interval={2} />
                  <YAxis tick={{ fill: c.axis, fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} labelFormatter={(h) => `${String(h).padStart(2, '0')}:00`} />
                  <Area type="monotone" dataKey="transactions" name="Transactions" stroke={c.accent} strokeWidth={2} fill="url(#gA)" />
                  <Area type="monotone" dataKey="flagged" name="Flagged fraud" stroke={c.bad} strokeWidth={2} fill="none" />
                </AreaChart>
              </ResponsiveContainer>
            </div>)}
        </Card>

        <Card title="Fraud vs legitimate" subtitle="Model decisions at the decision threshold">
          {!has ? <EmptyState title="No data" /> : (<>
            <div className="relative h-44">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={[{ name: 'Legitimate', value: data!.distribution.legitimate }, { name: 'Flagged fraud', value: data!.distribution.flagged }]}
                    dataKey="value" innerRadius={54} outerRadius={72} paddingAngle={2} stroke="none" startAngle={90} endAngle={-270}>
                    <Cell fill={c.accent} /><Cell fill={c.bad} />
                  </Pie>
                  <Tooltip content={<ChartTooltip fmt={(v) => int(v)} />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="tabular text-xl font-semibold">{pct(data!.distribution.flagged / Math.max(data!.kpis.total_transactions, 1))}</span>
                <span className="text-[11px] text-muted">flagged</span>
              </div>
            </div>
            <ul className="mt-3 space-y-2 text-xs">
              {[['Legitimate', data!.distribution.legitimate, c.accent], ['Flagged fraud', data!.distribution.flagged, c.bad]].map(([l, v, col]) => (
                <li key={l as string} className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: col as string }} /><span className="text-muted">{l}</span><span className="tabular ml-auto font-medium">{int(v as number)}</span></li>))}
            </ul>
          </>)}
        </Card>
      </div>

      <Card pad={false} title="Recent transactions" action={<Link to="/transactions" className="flex items-center gap-1 text-xs text-accent hover:underline">View all <ArrowRight size={12} /></Link>}>
        {!has || !data!.recent.length ? <EmptyState title="No transactions scored live yet">Held-out transactions get a real time once Live Monitoring scores them, and analysed ones when you submit them. Start the simulation or analyse a transaction to see activity here.</EmptyState> : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="border-y border-line bg-raised/40"><tr><th className="th pl-5">Transaction</th><th className="th">Amount</th><th className="th">Category</th><th className="th">Scored at</th><th className="th">Fraud probability</th><th className="th pr-5">Risk</th></tr></thead>
              <tbody className="divide-y divide-line">
                {data!.recent.map((t) => (
                  <tr key={t.id} onClick={() => setSel(t)} className="cursor-pointer hover:bg-raised/50">
                    <td className="td pl-5 font-mono text-xs">{t.id}</td><td className="td tabular">{num(t.amount)}</td><td className="td text-muted">{t.merchant_category}</td>
                    <td className="td text-muted">{dateTime(t.timestamp)}</td><td className="td tabular">{pct(t.fraud_probability)}</td><td className="td pr-5"><RiskBadge risk={t.risk_level} /></td>
                  </tr>))}
              </tbody>
            </table>
          </div>)}
      </Card>
      <TransactionModal tx={sel} onClose={() => setSel(null)} />
    </Page>
  );
}
