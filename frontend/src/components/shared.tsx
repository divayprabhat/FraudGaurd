import { createContext, useContext } from 'react';
import { Link } from 'react-router-dom';
import { Modal, RiskBadge, Notice, cx, riskColor } from './ui';
import { actionLabel, dateTime, num, pct, title } from '../lib/format';
import type { Health, Risk, Tx } from '../lib/types';

export const HealthCtx = createContext<{ health: Health | null; reload: () => void }>({ health: null, reload: () => {} });
export const useHealth = () => useContext(HealthCtx);

/** Shown on data pages when the model artifact or held-out data is missing. */
export function SetupNotice() {
  const { health } = useHealth();
  if (!health || (health.model_loaded && health.holdout_loaded)) return null;
  return (
    <Notice title={health.model_loaded ? 'Held-out transactions not found' : 'Trained model not found'}>
      {health.error ?? health.setup_help}
      <pre className="mt-2 overflow-x-auto rounded-md bg-raised p-2.5 font-mono text-[11px] text-fg">{`# put credit_card_fraud_10k.csv in backend/data/, then restart the API\n# (it trains automatically), or run manually:\ncd backend && python scripts/train_model.py`}</pre>
      No substitute predictions are generated.
    </Notice>
  );
}

export function ProbabilityMeter({ p, threshold, high, risk }: { p: number; threshold?: number; high?: number; risk: Risk }) {
  const tick = (v: number, label: string, align: string) => (
    <div className="absolute top-0 h-full" style={{ left: `${v * 100}%` }}>
      <div className="h-3 w-px bg-fg/50" />
      <span className={cx('absolute top-4 whitespace-nowrap text-[10px] text-muted', align)}>{label}</span>
    </div>
  );
  return (
    <div className="pb-6">
      <div className="relative h-3 rounded-full bg-raised">
        <div className={cx('h-full rounded-full transition-all duration-500', riskColor[risk])} style={{ width: `${Math.max(p * 100, 1)}%` }} />
        {threshold != null && tick(threshold, `threshold ${threshold.toFixed(2)}`, '-translate-x-1/2')}
        {high != null && tick(high, `high ≥ ${high.toFixed(2)}`, '-translate-x-1/2')}
      </div>
    </div>
  );
}

const field = (label: string, v: string | number) => (
  <div><dt className="text-xs text-muted">{label}</dt><dd className="tabular mt-0.5 font-medium">{v}</dd></div>
);

export function TransactionModal({ tx, onClose }: { tx: Tx | null; onClose: () => void }) {
  const { health } = useHealth();
  const th = health?.threshold, hi = health?.high_cutoff;
  return (
    <Modal open={!!tx} onClose={onClose} title="Transaction details">
      {tx && (
        <div className="space-y-5 p-5">
          <div className="flex items-start justify-between gap-3">
            <div><p className="font-mono text-sm font-semibold">{tx.id}</p><p className="mt-0.5 text-xs text-muted">{tx.source} · {tx.timestamp ? `scored ${dateTime(tx.timestamp)}` : 'not scored live yet (batch-scored at startup)'}</p></div>
            <RiskBadge risk={tx.risk_level} />
          </div>
          <div>
            <div className="mb-2 flex items-baseline justify-between"><span className="text-xs text-muted">Fraud probability</span><span className="tabular text-lg font-semibold">{pct(tx.fraud_probability, 2)}</span></div>
            <ProbabilityMeter p={tx.fraud_probability} threshold={th} high={hi} risk={tx.risk_level} />
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-4 sm:grid-cols-3">
            {field('Amount', num(tx.amount))}
            {field('Merchant category', tx.merchant_category)}
            {field('Transaction hour', `${String(tx.transaction_hour).padStart(2, '0')}:00`)}
            {field('Foreign transaction', tx.foreign_transaction ? 'Yes' : 'No')}
            {field('Location mismatch', tx.location_mismatch ? 'Yes' : 'No')}
            {field('Device trust score', tx.device_trust_score)}
            {field('Velocity (24h)', tx.velocity_last_24h)}
            {field('Cardholder age', tx.cardholder_age)}
          </dl>
          <dl className="grid grid-cols-2 gap-4 border-t border-line pt-4">
            {field('Recommended action', actionLabel(tx.recommended_action))}
            {field('Model version', tx.model_version)}
            {tx.actual_is_fraud !== null && field('Recorded label', tx.actual_is_fraud ? 'Fraud' : 'Legitimate')}
            {tx.actual_is_fraud !== null && field('Model outcome', tx.predicted_fraud === tx.actual_is_fraud ? 'Matches label' : tx.predicted_fraud ? 'False positive' : 'Missed fraud')}
          </dl>
          <p className="text-[11px] text-muted">{title(tx.source)} record. Risk bands follow the model's validation-selected threshold.{' '}
            <Link to="/fraud-detection" className="text-accent hover:underline" onClick={onClose}>Analyze another transaction</Link></p>
        </div>
      )}
    </Modal>
  );
}
