import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ScanSearch, RotateCcw, ShieldCheck } from 'lucide-react';
import { Button, Card, EmptyState, Page, RiskBadge, Segmented, Skeleton } from '../components/ui';
import { ProbabilityMeter, SetupNotice, useHealth } from '../components/shared';
import { api, useApi, ApiError } from '../lib/api';
import { useToast } from '../lib/toast';
import { actionLabel, ms, pct } from '../lib/format';
import type { Meta, Prediction } from '../lib/types';

interface Form { amount: string; transaction_hour: string; merchant_category: string; foreign_transaction: 0 | 1; location_mismatch: 0 | 1; device_trust_score: string; velocity_last_24h: string; cardholder_age: string }
const DEFAULTS: Form = { amount: '250', transaction_hour: '14', merchant_category: '', foreign_transaction: 0, location_mismatch: 0, device_trust_score: '75', velocity_last_24h: '2', cardholder_age: '35' };
// The sample transaction from the notebook (cell "score_transaction").
const NOTEBOOK_SAMPLE: Form = { amount: '920.50', transaction_hour: '2', merchant_category: 'Travel', foreign_transaction: 1, location_mismatch: 1, device_trust_score: '28', velocity_last_24h: '9', cardholder_age: '36' };

const NUMERIC: { key: keyof Form; label: string; hint: string; int: boolean; step?: string }[] = [
  { key: 'amount', label: 'Transaction amount', hint: 'Greater than 0', int: false, step: '0.01' },
  { key: 'transaction_hour', label: 'Transaction hour', hint: '0–23', int: true },
  { key: 'device_trust_score', label: 'Device trust score', hint: '0–100', int: true },
  { key: 'velocity_last_24h', label: 'Transactions in last 24h', hint: 'Count, 0 or more', int: true },
  { key: 'cardholder_age', label: 'Cardholder age', hint: '18–110', int: true },
];

export default function FraudDetection() {
  const { data: meta, loading: metaLoading } = useApi<Meta>('/meta');
  const { health } = useHealth();
  const toast = useToast();
  const [f, setF] = useState<Form>(DEFAULTS);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Prediction | null>(null);

  useEffect(() => { if (meta?.categories.length && !f.merchant_category) setF((s) => ({ ...s, merchant_category: meta.categories[0] })); }, [meta, f.merchant_category]);

  const errors: Partial<Record<keyof Form, string>> = {};
  NUMERIC.forEach(({ key, int }) => {
    const raw = String(f[key]).trim(); const v = Number(raw); const r = meta?.ranges[key];
    if (raw === '' || Number.isNaN(v)) errors[key] = 'Required';
    else if (int && !Number.isInteger(v)) errors[key] = 'Whole number';
    else if (r && key === 'amount' ? v <= 0 : r && (v < r[0] || v > r[1])) errors[key] = r ? (key === 'amount' ? 'Must be greater than 0' : `Between ${r[0]} and ${r[1]}`) : 'Invalid';
    else if (key === 'amount' && v > 1_000_000) errors[key] = 'Too large';
  });
  if (!f.merchant_category) errors.merchant_category = 'Required';
  const valid = Object.keys(errors).length === 0;
  const disabled = !health?.model_loaded;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setTouched(true);
    if (!valid || disabled) return;
    setBusy(true);
    try {
      const body = { ...f, amount: Number(f.amount), transaction_hour: Number(f.transaction_hour), device_trust_score: Number(f.device_trust_score), velocity_last_24h: Number(f.velocity_last_24h), cardholder_age: Number(f.cardholder_age) };
      const out = await api<Prediction>('/predict', { method: 'POST', body: JSON.stringify(body) });
      setRes(out);
      toast({ kind: out.risk_level === 'HIGH' ? 'error' : 'success', title: `${out.risk_level} risk`, message: `Fraud probability ${pct(out.fraud_probability)} · ${out.transaction_id}` });
    } catch (err) {
      toast({ kind: 'error', title: 'Analysis failed', message: (err as ApiError).message });
    } finally { setBusy(false); }
  };

  const show = (k: keyof Form) => (touched && errors[k] ? errors[k] : null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }));

  return (
    <Page>
      <SetupNotice />
      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3" title="Transaction details" subtitle="The eight inputs used by the trained model"
          action={<Button variant="ghost" className="h-8 text-xs" type="button" onClick={() => { setF({ ...NOTEBOOK_SAMPLE }); setTouched(false); }}>Load notebook sample</Button>}>
          {metaLoading ? <div className="space-y-3"><Skeleton className="h-9" /><Skeleton className="h-9" /><Skeleton className="h-9" /></div> : (
            <form onSubmit={submit} noValidate className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
              {NUMERIC.slice(0, 2).map(({ key, label, hint, step }) => (
                <div key={key}><label className="label" htmlFor={key}>{label}</label>
                  <input id={key} className="input tabular" inputMode="decimal" type="number" step={step ?? 1} value={f[key] as string} onChange={(e) => set(key, e.target.value as never)} aria-invalid={!!show(key)} />
                  <p className={show(key) ? 'mt-1 text-[11px] text-bad' : 'mt-1 text-[11px] text-muted'}>{show(key) ?? hint}</p></div>))}
              <div className="sm:col-span-2"><label className="label" htmlFor="cat">Merchant category</label>
                <select id="cat" className="input" value={f.merchant_category} onChange={(e) => set('merchant_category', e.target.value)}>
                  {(meta?.categories ?? []).map((c) => <option key={c}>{c}</option>)}
                </select>
                <p className="mt-1 text-[11px] text-muted">Categories seen during training</p></div>
              <div><span className="label">Foreign transaction</span>
                <Segmented label="Foreign transaction" value={f.foreign_transaction} onChange={(v) => set('foreign_transaction', v)} options={[{ value: 0, label: 'No' }, { value: 1, label: 'Yes' }]} /></div>
              <div><span className="label">Location mismatch</span>
                <Segmented label="Location mismatch" value={f.location_mismatch} onChange={(v) => set('location_mismatch', v)} options={[{ value: 0, label: 'No' }, { value: 1, label: 'Yes' }]} /></div>
              {NUMERIC.slice(2).map(({ key, label, hint }) => (
                <div key={key}><label className="label" htmlFor={key}>{label}</label>
                  <input id={key} className="input tabular" inputMode="numeric" type="number" step={1} value={f[key] as string} onChange={(e) => set(key, e.target.value as never)} aria-invalid={!!show(key)} />
                  <p className={show(key) ? 'mt-1 text-[11px] text-bad' : 'mt-1 text-[11px] text-muted'}>{show(key) ?? hint}</p></div>))}
              <div className="mt-1 flex items-center gap-2 sm:col-span-2">
                <Button type="submit" variant="primary" loading={busy} disabled={disabled} className="h-10 px-5"><ScanSearch size={16} />Analyze transaction</Button>
                <Button type="button" variant="ghost" onClick={() => { setF({ ...DEFAULTS, merchant_category: meta?.categories[0] ?? '' }); setRes(null); setTouched(false); }}><RotateCcw size={14} />Reset</Button>
              </div>
            </form>)}
        </Card>

        <Card className="lg:col-span-2" title="Prediction">
          {busy && !res ? <div className="space-y-3"><Skeleton className="h-10" /><Skeleton className="h-3" /><Skeleton className="h-24" /></div> :
            !res ? <EmptyState icon={<ShieldCheck size={18} />} title="No analysis yet">Enter transaction details and select “Analyze transaction” to score it with the trained model.</EmptyState> : (
              <div className="space-y-5">
                <div className="flex items-end justify-between">
                  <div><p className="text-xs text-muted">Fraud probability</p><p className="tabular mt-1 text-4xl font-semibold tracking-tight">{pct(res.fraud_probability, 1)}</p></div>
                  <RiskBadge risk={res.risk_level} />
                </div>
                <ProbabilityMeter p={res.fraud_probability} threshold={res.model_threshold} high={res.high_cutoff} risk={res.risk_level} />
                <dl className="space-y-3 border-t border-line pt-4 text-[13px]">
                  {([['Risk classification', res.risk_level], ['Model decision threshold', res.model_threshold.toFixed(2)], ['Recommended action', actionLabel(res.recommended_action)],
                    ['Model version', res.model_version], ['Scoring time', ms(res.latency_ms)]] as const).map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4"><dt className="text-muted">{k}</dt><dd className="tabular text-right font-medium">{v}</dd></div>))}
                </dl>
                <p className="text-[11px] text-muted">Saved as <Link className="font-mono text-accent hover:underline" to={`/transactions?q=${res.transaction_id}`}>{res.transaction_id}</Link>. LOW below the threshold, MEDIUM from the threshold, HIGH from {res.high_cutoff.toFixed(2)}.</p>
              </div>)}
        </Card>
      </div>
    </Page>
  );
}
