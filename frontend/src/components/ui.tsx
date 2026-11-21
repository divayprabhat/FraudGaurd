import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Inbox, Loader2, X } from 'lucide-react';
import type { Risk } from '../lib/types';

export const cx = (...c: (string | false | 0 | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Card({ title, subtitle, action, children, className, pad = true }: {
  title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; pad?: boolean;
}) {
  return (
    <section className={cx('card', className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 px-5 pt-4">
          <div className="min-w-0">
            {title && <h2 className="text-sm">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={cx(pad && 'p-5', title && pad && 'pt-4')}>{children}</div>
    </section>
  );
}

export function Button({ variant = 'secondary', loading, className, children, disabled, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; loading?: boolean;
}) {
  const v = {
    primary: 'bg-accent text-white hover:brightness-110 border-transparent dark:text-[#0b0e14]',
    secondary: 'bg-surface border-line hover:bg-raised text-fg',
    ghost: 'border-transparent text-muted hover:bg-raised hover:text-fg',
    danger: 'bg-bad/10 text-bad border-bad/30 hover:bg-bad/15',
  }[variant];
  return (
    <button {...p} disabled={disabled || loading}
      className={cx('themed inline-flex h-9 items-center justify-center gap-2 rounded-md border px-3.5 text-[13px] font-medium transition active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50', v, className)}>
      {loading && <Loader2 size={14} className="animate-spin" />}{children}
    </button>
  );
}

const riskStyle: Record<Risk, string> = { LOW: 'bg-ok/10 text-ok', MEDIUM: 'bg-warn/10 text-warn', HIGH: 'bg-bad/10 text-bad' };
export const riskColor: Record<Risk, string> = { LOW: 'bg-ok', MEDIUM: 'bg-warn', HIGH: 'bg-bad' };
export function RiskBadge({ risk }: { risk: Risk }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold', riskStyle[risk])}>
      <span className={cx('h-1.5 w-1.5 rounded-full', riskColor[risk])} />{risk}
    </span>
  );
}

export function Pill({ tone = 'muted', children }: { tone?: 'muted' | 'ok' | 'warn' | 'bad' | 'accent'; children: ReactNode }) {
  const t = { muted: 'bg-raised text-muted', ok: 'bg-ok/10 text-ok', warn: 'bg-warn/10 text-warn', bad: 'bg-bad/10 text-bad', accent: 'bg-accent/10 text-accent' }[tone];
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', t)}>{children}</span>;
}

export function Stat({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="card card-hover px-4 py-3.5">
      <div className="flex items-center justify-between text-xs text-muted"><span>{label}</span>{icon && <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent/10 text-accent">{icon}</span>}</div>
      <div className="tabular mt-2.5 text-[24px] font-semibold leading-none tracking-tight">{value}</div>
      {hint && <div className="mt-2 text-[11px] text-muted">{hint}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('shimmer rounded-md bg-raised', className)} />;
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-raised text-muted">{icon ?? <Inbox size={18} />}</div>
      <p className="font-medium">{title}</p>
      {children && <p className="mt-1 max-w-md text-xs leading-relaxed text-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card border-bad/30">
      <EmptyState icon={<AlertTriangle size={18} className="text-bad" />} title="Something went wrong"
        action={onRetry && <Button onClick={onRetry}>Try again</Button>}>{message}</EmptyState>
    </div>
  );
}

export function Notice({ tone = 'warn', title, children }: { tone?: 'warn' | 'accent'; title: string; children: ReactNode }) {
  return (
    <div className={cx('flex gap-3 rounded-lg border px-4 py-3 text-xs leading-relaxed', tone === 'warn' ? 'border-warn/30 bg-warn/5' : 'border-accent/30 bg-accent/5')}>
      <AlertTriangle size={16} className={cx('mt-0.5 shrink-0', tone === 'warn' ? 'text-warn' : 'text-accent')} />
      <div><p className="font-medium text-fg">{title}</p><div className="mt-0.5 text-muted">{children}</div></div>
    </div>
  );
}

export function Modal({ open, onClose, title, children, width = 'max-w-lg' }: { open: boolean; onClose: () => void; title: string; children: ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return;
    const fn = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
          <motion.div className="absolute inset-0 bg-black/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.15 }}
            className={cx('card relative max-h-[90vh] w-full overflow-y-auto rounded-b-none shadow-2xl sm:rounded-b-lg', width)}>
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface px-5 py-3.5">
              <h2 className="text-sm">{title}</h2>
              <button onClick={onClose} aria-label="Close" className="rounded p-1 text-muted hover:bg-raised hover:text-fg"><X size={16} /></button>
            </div>
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export function Segmented<T extends string | number>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label?: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-md border border-line bg-raised p-0.5">
      {options.map((o) => (
        <button key={String(o.value)} type="button" onClick={() => onChange(o.value)} aria-pressed={value === o.value}
          className={cx('themed h-8 rounded px-3 text-xs font-medium', value === o.value ? 'bg-surface text-fg shadow-card' : 'text-muted hover:text-fg')}>{o.label}</button>
      ))}
    </div>
  );
}

export function ChartTooltip({ active, payload, label, fmt }: {
  active?: boolean; payload?: { name: string; value: number; color?: string; fill?: string }[]; label?: string | number; fmt?: (v: number, name: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="card px-3 py-2 text-xs shadow-lg">
      {label !== undefined && <p className="mb-1 font-medium">{label}</p>}
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2 text-muted">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color ?? p.fill }} />{p.name}
          <span className="tabular ml-auto pl-4 font-medium text-fg">{fmt ? fmt(p.value, p.name) : p.value}</span>
        </p>
      ))}
    </div>
  );
}

export function Page({ children }: { children: ReactNode }) {
  return <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18 }} className="stagger space-y-5">{children}</motion.div>;
}
