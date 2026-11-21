import { Monitor, Moon, Sun } from 'lucide-react';
import { Card, Page, Pill, Segmented } from '../components/ui';
import { useHealth } from '../components/shared';
import { useApi } from '../lib/api';
import { useTheme, type ThemeMode } from '../lib/theme';
import type { Meta } from '../lib/types';

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-4 border-b border-line py-2.5 text-[13px] last:border-0"><dt className="text-muted">{k}</dt><dd className="tabular text-right font-medium">{v}</dd></div>);

export default function Settings() {
  const { mode, setMode } = useTheme();
  const { health } = useHealth();
  const { data: meta } = useApi<Meta & { alert_thresholds: Record<string, number> }>('/meta');
  const t = meta?.alert_thresholds;
  return (
    <Page>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Appearance" subtitle="Saved in this browser">
          <Segmented<ThemeMode> label="Theme" value={mode} onChange={setMode} options={[
            { value: 'light', label: <span className="flex items-center gap-1.5"><Sun size={13} />Light</span> },
            { value: 'dark', label: <span className="flex items-center gap-1.5"><Moon size={13} />Dark</span> },
            { value: 'system', label: <span className="flex items-center gap-1.5"><Monitor size={13} />System</span> }]} />
        </Card>
        <Card title="Model">
          <dl>
            <Row k="Status" v={health?.model_loaded ? <Pill tone="ok">Loaded</Pill> : <Pill tone="bad">Not loaded</Pill>} />
            <Row k="Algorithm" v={health?.model_name ?? '—'} />
            <Row k="Version" v={health?.model_version ?? '—'} />
            <Row k="Decision threshold" v={health ? health.threshold.toFixed(2) : '—'} />
            <Row k="HIGH risk from" v={health ? health.high_cutoff.toFixed(2) : '—'} />
            <Row k="Trained on" v={health?.synthetic_demo_data == null ? '—' : health.synthetic_demo_data ? <Pill tone="warn">Synthetic data</Pill> : 'Your dataset'} />
            <Row k="Held-out transactions" v={health?.holdout_loaded ? 'Loaded' : 'Missing'} />
            <Row k="Evaluation source" v={health?.evaluation_source === 'recomputed' ? 'Recomputed locally' : 'Notebook outputs'} />
          </dl>
        </Card>
        <Card title="Alert thresholds" subtitle="From the notebook’s monitoring cell. Read-only.">
          <dl>
            <Row k="Predicted fraud rate above" v={t ? `${t.high_risk_rate_alert_pct}% (min ${t.min_events_for_rate_alert} events)` : '—'} />
            <Row k="p95 latency above" v={t ? `${t.p95_latency_alert_ms} ms` : '—'} />
            <Row k="Freshness SLA compliance below" v={t ? `${t.min_freshness_sla_compliance_pct}% within ${t.freshness_sla_seconds}s` : '—'} />
          </dl>
        </Card>
        <Card title="About this data">
          <ul className="list-disc space-y-2 pl-4 text-[13px] leading-relaxed text-muted">
            <li>Transactions are the model’s held-out test split, scored by the trained model, plus anything analysed here. Amounts have no currency in the dataset.</li>
            <li>Live Monitoring is a <strong className="text-fg">simulated replay</strong> of that split. No real banking transactions are monitored.</li>
            <li>Analysed and replayed transactions are held in memory and reset when the API restarts.</li>
          </ul>
        </Card>
      </div>
    </Page>
  );
}
