import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, ChartTooltip, EmptyState, ErrorState, Notice, Page, Pill, Skeleton, Stat, cx } from '../components/ui';
import { useApi } from '../lib/api';
import { useChartColors } from '../lib/theme';
import { int, pct, title } from '../lib/format';
import type { ModelRow, Performance as P } from '../lib/types';

const ROWS: { key: keyof ModelRow; label: string }[] = [
  { key: 'accuracy', label: 'Accuracy' }, { key: 'precision', label: 'Precision' }, { key: 'recall', label: 'Recall' },
  { key: 'f1', label: 'F1 score' }, { key: 'roc_auc', label: 'ROC-AUC' }, { key: 'pr_auc', label: 'PR-AUC' },
];

export default function Performance() {
  const { data, error, loading, reload } = useApi<P>('/performance');
  const c = useChartColors();
  if (error && !data) return <ErrorState message={error.message} onRetry={reload} />;
  if (loading || !data) return <Page><Skeleton className="h-64" /><div className="grid gap-5 lg:grid-cols-2"><Skeleton className="h-72" /><Skeleton className="h-72" /></div></Page>;

  const tm = data.test_metrics, cm = data.confusion_matrix;
  const models = data.validation_summary;
  const best = (key: keyof ModelRow) => { const vals = models.map((m) => m[key] as number | null).filter((v): v is number => v != null); return models.length > 1 && vals.length > 1 ? Math.max(...vals) : null; };
  const cmax = Math.max(cm.tn, cm.fp, cm.fn, cm.tp);
  const cell = (v: number, good: boolean, l: string) => (
    <div className="flex flex-col items-center justify-center rounded-md border border-line p-4 text-center" style={{ background: `rgb(var(--${good ? 'ok' : 'bad'}) / ${0.06 + 0.2 * (v / cmax)})` }}>
      <span className="tabular text-xl font-semibold text-fg">{int(v)}</span><span className="mt-0.5 text-[11px] text-muted">{l}</span></div>);
  const imp = data.feature_importance?.items.slice(0, 10).map((i) => ({ ...i, name: title(i.feature.replace('merchant_category_', 'category: ')) }));
  const axis = { tick: { fill: c.axis, fontSize: 11 }, tickLine: false } as const;

  return (
    <Page>
      <Notice tone="accent" title={data.source === 'recomputed' ? 'Evaluation recomputed from your dataset' : 'Evaluation from the notebook outputs'}>
        {data.source_note} Dataset: {int(data.dataset.rows)} transactions, {pct(data.dataset.fraud_rate, 2)} fraud · split {Object.entries(data.dataset.split).map(([k, v]) => `${k} ${int(v)}`).join(' / ')}.
      </Notice>

      <Card pad={false} title="Model comparison" subtitle={`Validation set. Precision, recall, F1 and accuracy use a ${(data.validation_cutoff ?? 0.5).toFixed(2)} cut-off; the winner is chosen by ${data.selection_metric.replace(/_/g, '-').toUpperCase()}.`}>
        <div className="mt-3 overflow-x-auto"><table className="w-full text-[13px]">
          <thead className="border-y border-line"><tr><th className="th pl-5">Metric</th>
            {models.map((m) => (<th key={m.model} className={cx('th', m.model === data.selected_model && 'bg-accent/5')}>
              <span className="inline-flex items-center gap-2 text-fg">{m.model}{m.model === data.selected_model && <Pill tone="accent">Selected</Pill>}</span></th>))}</tr></thead>
          <tbody className="divide-y divide-line">
            {ROWS.map((r) => { const b = best(r.key); return (
              <tr key={r.key}><td className="td pl-5 text-muted">{r.label}</td>
                {models.map((m) => { const v = m[r.key] as number | null; return (
                  <td key={m.model} className={cx('td tabular', m.model === data.selected_model && 'bg-accent/5', v != null && v === b && 'font-semibold')}>{v == null ? <span className="text-muted" title="Not reported in the notebook">—</span> : v.toFixed(4)}</td>); })}</tr>); })}
            <tr><td className="td pl-5 text-muted">Training time</td>{models.map((m) => <td key={m.model} className={cx('td tabular text-muted', m.model === data.selected_model && 'bg-accent/5')}>{m.fit_seconds.toFixed(2)} s</td>)}</tr>
          </tbody></table></div>
        {models.some((m) => m.accuracy == null) && <p className="px-5 pb-4 pt-2 text-[11px] text-muted">— The notebook did not report validation accuracy. Run scripts/train_model.py to compute it.</p>}
      </Card>

      <div>
        <h2 className="mb-3 text-sm">{data.selected_model} · test set at threshold {data.threshold.toFixed(2)}</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Stat label="Accuracy" value={pct(tm.accuracy, 2)} /><Stat label="Precision" value={pct(tm.precision, 2)} /><Stat label="Recall" value={pct(tm.recall, 2)} />
          <Stat label="F1 score" value={pct(tm.f1, 2)} /><Stat label="ROC-AUC" value={tm.roc_auc.toFixed(4)} /><Stat label="PR-AUC" value={tm.pr_auc.toFixed(4)} />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Confusion matrix" subtitle={cm.derived ? 'Derived exactly from the notebook’s reported metrics' : 'Test set'}>
          <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-2 text-[11px] text-muted">
            <span /><span className="text-center">Predicted legitimate</span><span className="text-center">Predicted fraud</span>
            <span className="[writing-mode:vertical-rl] rotate-180 text-center">Actual legit.</span>{cell(cm.tn, true, 'True negative')}{cell(cm.fp, false, 'False positive')}
            <span className="[writing-mode:vertical-rl] rotate-180 text-center">Actual fraud</span>{cell(cm.fn, false, 'False negative')}{cell(cm.tp, true, 'True positive')}
          </div>
        </Card>

        <Card title="ROC curve" subtitle={`Test set · AUC ${tm.roc_auc.toFixed(4)}`}>
          {!data.roc_curve ? <EmptyState title="ROC points not in notebook outputs">The notebook only saved the curve as an image. Run <code className="font-mono">python scripts/train_model.py</code> to compute it.</EmptyState> : (
            <div className="h-56"><ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.roc_curve} margin={{ top: 4, right: 8, left: -10, bottom: 14 }}>
                <CartesianGrid stroke={c.grid} />
                <XAxis dataKey="fpr" type="number" domain={[0, 1]} {...axis} axisLine={{ stroke: c.grid }} tickFormatter={(v) => v.toFixed(1)} label={{ value: 'False positive rate', position: 'insideBottom', offset: -8, fill: c.axis, fontSize: 11 }} />
                <YAxis type="number" domain={[0, 1]} {...axis} axisLine={false} tickFormatter={(v) => v.toFixed(1)} />
                <Tooltip content={<ChartTooltip fmt={(v) => v.toFixed(3)} />} />
                <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke={c.axis} strokeDasharray="4 4" />
                <Area type="stepAfter" dataKey="tpr" name="True positive rate" stroke={c.accent} strokeWidth={2} fill={c.accent} fillOpacity={0.12} isAnimationActive={false} />
              </AreaChart></ResponsiveContainer></div>)}
        </Card>

        <Card title="Feature importance" subtitle={data.feature_importance?.kind === 'coefficient' ? 'Logistic regression coefficients' : 'Top 10 · random forest importance'}>
          {!imp ? <EmptyState title="Not in notebook outputs">The notebook only saved this chart as an image. Run <code className="font-mono">python scripts/train_model.py</code> to compute it.</EmptyState> : (
            <div className="h-56"><ResponsiveContainer width="100%" height="100%">
              <BarChart data={imp} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                <XAxis type="number" hide /><YAxis type="category" dataKey="name" width={132} {...axis} axisLine={false} />
                <Tooltip content={<ChartTooltip fmt={(v) => v.toFixed(4)} />} />
                <Bar dataKey="value" name="Importance" radius={[0, 3, 3, 0]} isAnimationActive={false}>{imp.map((i) => <Cell key={i.feature} fill={i.value < 0 ? c.warn : c.accent} />)}</Bar>
              </BarChart></ResponsiveContainer></div>)}
        </Card>
      </div>
    </Page>
  );
}
