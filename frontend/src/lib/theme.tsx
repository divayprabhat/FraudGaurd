import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
const KEY = 'fraudguard-theme';
interface Ctx { mode: ThemeMode; resolved: 'light' | 'dark'; setMode: (m: ThemeMode) => void }
const ThemeCtx = createContext<Ctx>({ mode: 'dark', resolved: 'dark', setMode: () => {} });
export const useTheme = () => useContext(ThemeCtx);

const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    try { return (localStorage.getItem(KEY) as ThemeMode) || 'dark'; } catch { return 'dark'; }
  });
  const [sys, setSys] = useState(systemDark);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const fn = () => setSys(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  const resolved = mode === 'system' ? (sys ? 'dark' : 'light') : mode;
  useEffect(() => { document.documentElement.classList.toggle('dark', resolved === 'dark'); }, [resolved]);
  const value = useMemo<Ctx>(() => ({
    mode, resolved,
    setMode: (m) => { setModeState(m); try { localStorage.setItem(KEY, m); } catch { /* ignore */ } },
  }), [mode, resolved]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

/** Concrete colours for SVG charts (Recharts), per resolved theme. */
export function useChartColors() {
  const { resolved } = useTheme();
  return resolved === 'dark'
    ? { grid: '#262d3a', axis: '#8a93a6', accent: '#5b9cff', ok: '#3ecf82', warn: '#f5b041', bad: '#f46262', soft: '#2b3547', fg: '#e8ecf3' }
    : { grid: '#e4e7ec', axis: '#5f6b7f', accent: '#2457d6', ok: '#12854e', warn: '#b06c06', bad: '#c92a2a', soft: '#d5dbe6', fg: '#0f1b33' };
}
