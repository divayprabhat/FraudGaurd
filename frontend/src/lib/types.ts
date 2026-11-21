export type Risk = 'LOW' | 'MEDIUM' | 'HIGH';

export interface Health {
  status: string; model_loaded: boolean; model_name: string; model_version: string | null;
  threshold: number; high_cutoff: number; synthetic_demo_data: boolean | null; holdout_loaded: boolean;
  evaluation_source: 'recomputed' | 'notebook'; error: string | null; setup_help: string | null;
}
export interface Meta {
  features: string[]; categories: string[]; ranges: Record<string, [number, number]>;
  risk_bands: { threshold: number; high_cutoff: number | null }; actions: Record<Risk, string>;
}
export interface Tx {
  id: string; amount: number; merchant_category: string; transaction_hour: number; foreign_transaction: number;
  location_mismatch: number; device_trust_score: number; velocity_last_24h: number; cardholder_age: number;
  fraud_probability: number; risk_level: Risk; recommended_action: string; predicted_fraud: number;
  actual_is_fraud: number | null; source: string; timestamp: string | null; model_version: string;
}
export interface TxPage { items: Tx[]; total: number; page: number; page_size: number; pages: number; available: boolean }
export interface Prediction {
  fraud_probability: number; model_threshold: number; high_cutoff: number; risk_level: Risk; recommended_action: string;
  predicted_fraud: number; model_version: string; latency_ms: number; transaction_id: string; timestamp: string;
}
export interface Dashboard {
  available: boolean; evaluation_source: string;
  kpis: { total_transactions: number; flagged_fraud: number; confirmed_fraud_labels: number; detection_rate: number; accuracy: number; avg_latency_ms: number | null; latency_source: string; latency_samples: number };
  activity_by_hour: { hour: number; transactions: number; flagged: number }[];
  distribution: { flagged: number; legitimate: number; by_risk: Record<Risk, number> };
  recent: Tx[];
}
export interface ModelRow { model: string; pr_auc: number; roc_auc: number; precision: number; recall: number; f1: number; accuracy: number | null; fit_seconds: number }
export interface Performance {
  source: 'recomputed' | 'notebook'; source_note: string; validation_cutoff?: number; selected_model: string; selection_metric: string;
  threshold: number; threshold_selection: string;
  dataset: { rows: number; fraud: number; legitimate: number; fraud_rate: number; split: Record<string, number> };
  validation_summary: ModelRow[];
  test_metrics: { accuracy: number; precision: number; recall: number; f1: number; roc_auc: number; pr_auc: number; false_positive_rate: number };
  confusion_matrix: { tn: number; fp: number; fn: number; tp: number; derived: boolean };
  roc_curve: { fpr: number; tpr: number }[] | null;
  feature_importance: { kind: string; items: { feature: string; value: number }[] } | null;
}
export interface FeedEvent {
  transaction_id: string; amount: number; merchant_category: string; fraud_probability: number; risk_level: Risk;
  latency_ms: number; processing_time_utc: string;
}
export interface Monitoring {
  mode: string; running: boolean; available: boolean; description: string; started_at: string | null;
  kpis: {
    transactions_processed: number; high_risk: number; medium_risk: number; predicted_fraud: number; predicted_fraud_rate_pct: number;
    mean_latency_ms: number | null; p95_latency_ms: number | null; throughput_eps: number | null; scoring_capacity_eps: number | null;
    freshness_sla_compliance_pct: number | null; mean_lag_s: number | null; max_lag_s: number | null;
  };
  target_events_per_second?: number; freshness_definition?: string;
  feed: FeedEvent[];
  series: { t: string; processed: number; high: number; medium: number; avg_latency_ms: number; p95_latency_ms: number }[];
  health: { name: string; status: 'healthy' | 'warning' | 'critical' | 'idle'; detail: string }[];
}
export interface Alert {
  id: string; type: string; severity: 'warning' | 'critical'; description: string; timestamp: string;
  status: 'open' | 'acknowledged' | 'resolved'; observed: string; threshold: string;
}
export interface AlertsResponse { items: Alert[]; counts: Record<Alert['status'], number>; open_critical: number }
