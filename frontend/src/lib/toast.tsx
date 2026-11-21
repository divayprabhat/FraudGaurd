import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';

type Kind = 'success' | 'error' | 'info';
interface Toast { id: number; kind: Kind; title: string; message?: string }
const Ctx = createContext<(t: Omit<Toast, 'id'>) => void>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const dismiss = (id: number) => setItems((l) => l.filter((t) => t.id !== id));
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setItems((l) => [...l.slice(-3), { ...t, id }]);
    setTimeout(() => dismiss(id), 4500);
  }, []);
  const icon = { success: <CheckCircle2 size={16} className="text-ok" />, error: <XCircle size={16} className="text-bad" />, info: <Info size={16} className="text-accent" /> };
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2" role="status" aria-live="polite">
        <AnimatePresence>
          {items.map((t) => (
            <motion.div key={t.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
              className="card pointer-events-auto flex items-start gap-3 p-3 shadow-lg">
              <span className="mt-0.5">{icon[t.kind]}</span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{t.title}</p>
                {t.message && <p className="mt-0.5 break-words text-xs text-muted">{t.message}</p>}
              </div>
              <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="text-muted hover:text-fg"><X size={14} /></button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
