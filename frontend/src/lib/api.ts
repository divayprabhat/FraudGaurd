import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

function detailToText(d: unknown): string {
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map((e: { loc?: string[]; msg?: string }) => `${(e.loc ?? []).slice(1).join('.')}: ${e.msg}`).join('; ');
  return 'Request failed';
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { headers: { 'Content-Type': 'application/json' }, ...init });
  } catch {
    throw new ApiError('Cannot reach the FraudGuard API. Is the backend running on port 8000?', 0);
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { msg = detailToText((await res.json()).detail); } catch { /* keep default */ }
    throw new ApiError(msg, res.status);
  }
  return res.json() as Promise<T>;
}

/** GET with loading/error state, optional polling, and manual reload. */
export function useApi<T>(path: string, opts: { interval?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const pathRef = useRef(path);
  pathRef.current = path;

  const load = useCallback(async () => {
    const p = pathRef.current;
    try {
      const d = await api<T>(p);
      if (p === pathRef.current) { setData(d); setError(null); }
    } catch (e) {
      if (p === pathRef.current) setError(e as ApiError);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { setLoading(true); load(); }, [path, load]);
  useEffect(() => {
    if (!opts.interval) return;
    const t = setInterval(load, opts.interval);
    return () => clearInterval(t);
  }, [opts.interval, load]);

  return { data, error, loading, reload: load };
}
