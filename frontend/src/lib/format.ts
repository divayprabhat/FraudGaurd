export const num = (n: number, d = 2) => n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
export const int = (n: number) => n.toLocaleString();
export const pct = (n: number, d = 1) => `${(n * 100).toFixed(d)}%`;
export const ms = (n: number | null | undefined) => (n == null ? '—' : n < 10 ? `${n.toFixed(2)} ms` : `${n.toFixed(1)} ms`);
export const dateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
export const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour12: false });
export const actionLabel = (a: string) => ({ STANDARD_PROCESSING: 'Standard processing', MANUAL_REVIEW: 'Manual review', ESCALATE_FOR_REVIEW: 'Escalate for review' }[a] ?? a);
export const title = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
