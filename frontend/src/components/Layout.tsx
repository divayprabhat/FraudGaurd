import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Activity, BarChart3, Bell, CreditCard, LayoutDashboard, Menu, Monitor, Moon, Radio, Search, Settings, ShieldAlert, ShieldCheck, Sun, X } from 'lucide-react';
import { cx, Pill } from './ui';
import { HealthCtx } from './shared';
import { useApi } from '../lib/api';
import { useTheme, type ThemeMode } from '../lib/theme';
import { dateTime } from '../lib/format';
import type { AlertsResponse, Health } from '../lib/types';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/transactions', label: 'Transactions', icon: CreditCard },
  { to: '/fraud-detection', label: 'Fraud Detection', icon: ShieldAlert },
  { to: '/monitoring', label: 'Live Monitoring', icon: Radio },
  { to: '/performance', label: 'Model Performance', icon: BarChart3 },
  { to: '/alerts', label: 'Alerts', icon: Bell },
];
const TITLES: Record<string, string> = { '/': 'Overview', '/transactions': 'Transactions', '/fraud-detection': 'Fraud Detection', '/monitoring': 'Live Monitoring', '/performance': 'Model Performance', '/alerts': 'Alerts', '/settings': 'Settings' };

function useOutside(ref: React.RefObject<HTMLElement>, fn: () => void, on: boolean) {
  useEffect(() => {
    if (!on) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && fn();
    const k = (e: KeyboardEvent) => e.key === 'Escape' && fn();
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [ref, fn, on]);
}

function Menu_({ trigger, children, align = 'right', label }: { trigger: ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right'; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false), open);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label={label} aria-expanded={open}
        className="themed relative flex h-9 items-center justify-center gap-2 rounded-md px-2.5 text-muted hover:bg-raised hover:text-fg">{trigger}</button>
      {open && <div className={cx('card absolute top-11 z-40 w-64 p-1.5 shadow-xl', align === 'right' ? 'right-0' : 'left-0')}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

function ThemeSwitcher() {
  const { mode, setMode, resolved } = useTheme();
  const opts: { v: ThemeMode; label: string; icon: ReactNode }[] = [
    { v: 'light', label: 'Light', icon: <Sun size={15} /> }, { v: 'dark', label: 'Dark', icon: <Moon size={15} /> }, { v: 'system', label: 'System', icon: <Monitor size={15} /> }];
  return (
    <Menu_ label="Change theme" trigger={resolved === 'dark' ? <Moon size={17} /> : <Sun size={17} />}>
      {(close) => opts.map((o) => (
        <button key={o.v} onClick={() => { setMode(o.v); close(); }}
          className={cx('flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] hover:bg-raised', mode === o.v ? 'text-accent' : 'text-fg')}>
          {o.icon}{o.label}{mode === o.v && <span className="ml-auto text-[11px]">Active</span>}
        </button>))}
    </Menu_>
  );
}

function Notifications() {
  const { data } = useApi<AlertsResponse>('/alerts', { interval: 5000 });
  const nav = useNavigate();
  const open = (data?.items ?? []).filter((a) => a.status === 'open');
  return (
    <Menu_ label="Notifications" trigger={<><Bell size={17} />{open.length > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-bad px-1 text-[10px] font-semibold text-white">{open.length > 99 ? '99+' : open.length}</span>}</>}>
      {(close) => (
        <div className="w-[min(20rem,calc(100vw-2rem))]">
          <p className="px-2.5 py-2 text-xs font-medium text-muted">Open alerts</p>
          {open.length === 0 ? <p className="px-2.5 pb-3 text-xs text-muted">Nothing needs attention.</p> :
            open.slice(0, 5).map((a) => (
              <button key={a.id} onClick={() => { nav('/alerts'); close(); }} className="block w-full rounded-md px-2.5 py-2 text-left hover:bg-raised">
                <span className="flex items-center gap-2 text-[13px] font-medium"><span className={cx('h-1.5 w-1.5 rounded-full', a.severity === 'critical' ? 'bg-bad' : 'bg-warn')} />{a.type}</span>
                <span className="mt-0.5 block text-[11px] text-muted">{dateTime(a.timestamp)}</span>
              </button>))}
          <button onClick={() => { nav('/alerts'); close(); }} className="mt-1 w-full rounded-md border-t border-line px-2.5 py-2 text-left text-xs text-accent hover:bg-raised">View all alerts</button>
        </div>)}
    </Menu_>
  );
}

function ModelStatus({ health }: { health: Health | null }) {
  const ok = !!health?.model_loaded;
  return (
    <NavLink to="/settings" className="hidden items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-xs md:flex" title={ok ? 'Model loaded' : 'Model artifact missing'}>
      <span className={cx('h-1.5 w-1.5 rounded-full', health === null ? 'bg-muted' : ok ? 'bg-ok' : 'bg-bad')} />
      <span className="text-muted">Model</span>
      <span className="font-medium">{health === null ? '…' : ok ? health.model_version : 'Not loaded'}</span>
    </NavLink>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const link = ({ isActive }: { isActive: boolean }) => cx('group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors',
    isActive ? 'bg-raised text-fg' : 'text-muted hover:bg-raised/60 hover:text-fg');
  const item = (n: { to: string; label: string; icon: typeof Activity; end?: boolean }) => (
    <NavLink key={n.to} to={n.to} end={n.end} className={link} onClick={onNavigate}>
      {({ isActive }) => (<>
        {isActive && <span className="absolute -left-3 top-1.5 h-5 w-[3px] rounded-r bg-accent" />}
        <n.icon size={16} className={isActive ? 'text-accent' : ''} />{n.label}
      </>)}
    </NavLink>);
  return (
    <div className="flex h-full flex-col px-3 py-4">
      <div className="mb-6 flex items-center gap-2.5 px-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-white dark:text-[#0b0e14]"><ShieldCheck size={16} strokeWidth={2.4} /></div>
        <span className="text-sm font-semibold tracking-[0.12em]">FRAUDGUARD</span>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5" aria-label="Primary">{NAV.map(item)}</nav>
      <div className="border-t border-line pt-3">{item({ to: '/settings', label: 'Settings', icon: Settings })}</div>
    </div>
  );
}

export default function Layout() {
  const { data: health, reload } = useApi<Health>('/health', { interval: 10000 });
  const [drawer, setDrawer] = useState(false);
  const [q, setQ] = useState('');
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => { setDrawer(false); window.scrollTo(0, 0); }, [loc.pathname]);
  const submit = (e: React.FormEvent) => { e.preventDefault(); nav(`/transactions?q=${encodeURIComponent(q.trim())}`); };
  return (
    <HealthCtx.Provider value={{ health, reload }}>
      <div className="min-h-screen">
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 border-r border-line bg-surface lg:block themed"><Sidebar /></aside>
        {drawer && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-black/50" onClick={() => setDrawer(false)} />
            <aside className="absolute inset-y-0 left-0 w-60 border-r border-line bg-surface">
              <button onClick={() => setDrawer(false)} aria-label="Close menu" className="absolute right-2 top-3 rounded p-1.5 text-muted"><X size={16} /></button>
              <Sidebar onNavigate={() => setDrawer(false)} />
            </aside>
          </div>)}
        <div className="lg:pl-56">
          <header className="themed sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-bg/85 px-4 backdrop-blur sm:px-6">
            <button className="rounded-md p-1.5 text-muted hover:bg-raised lg:hidden" onClick={() => setDrawer(true)} aria-label="Open menu"><Menu size={18} /></button>
            <h1 className="mr-auto truncate text-[15px]">{TITLES[loc.pathname] ?? 'FRAUDGUARD'}</h1>
            <form onSubmit={submit} className="relative hidden w-64 sm:block" role="search">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search transactions" aria-label="Search transactions" className="input h-8 pl-8 text-xs" />
            </form>
            <ModelStatus health={health} />
            <div className="flex items-center">
              <Notifications />
              <ThemeSwitcher />
              <Menu_ label="Account" trigger={<span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/15 text-[11px] font-semibold text-accent">FA</span>}>
                {(close) => (<div>
                  <div className="px-2.5 py-2"><p className="text-[13px] font-medium">Fraud analyst</p><p className="text-xs text-muted">Local session · no sign-in required</p></div>
                  <button onClick={() => { nav('/settings'); close(); }} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-[13px] hover:bg-raised"><Settings size={15} />Settings</button>
                  <div className="px-2.5 pb-1.5 pt-1"><Pill>v1.0.0</Pill></div>
                </div>)}
              </Menu_>
            </div>
          </header>
          <main className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6"><Outlet /></main>
        </div>
      </div>
    </HealthCtx.Provider>
  );
}
