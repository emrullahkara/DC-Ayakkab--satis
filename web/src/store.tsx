import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setUnauthorizedHandler } from './api';

export interface Store { id: number; code: string; name: string; city: string | null; is_warehouse: number }
export interface Session {
  user: { id: number; username: string; name: string; role: string; roleLabel: string; isSuperadmin: boolean; perms: string[] };
  tenant: { id: number; code: string; name: string; plan: string; license_until: string | null };
  stores: Store[];
  settings: any;
  permissions: Record<string, string>;
  shift: any;
}

interface Ctx {
  session: Session | null;
  loading: boolean;
  storeId: number | null;
  setStoreId: (id: number | null) => void;
  store: Store | null;
  can: (...perms: string[]) => boolean;
  login: (tenant: string, username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  toast: (msg: string, kind?: 'ok' | 'err' | 'info') => void;
  toasts: { id: number; msg: string; kind: string }[];
}

const C = createContext<Ctx>(null as any);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [storeId, setStoreIdState] = useState<number | null>(() => Number(localStorage.getItem('dc_store')) || null);
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: string }[]>([]);

  const toast = useCallback((msg: string, kind: 'ok' | 'err' | 'info' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 6000 : 3000);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const s = await api.get<Session>('/auth/me');
      setSession(s);
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setSession(null));
    if (localStorage.getItem('dc_token')) refresh();
    else setLoading(false);
  }, [refresh]);

  useEffect(() => {
    if (!session) return;
    const ids = session.stores.map((s) => s.id);
    if (!storeId || !ids.includes(storeId)) {
      const first = session.stores.find((s) => !s.is_warehouse) ?? session.stores[0];
      setStoreIdState(first?.id ?? null);
    }
  }, [session, storeId]);

  const setStoreId = (id: number | null) => {
    setStoreIdState(id);
    if (id) localStorage.setItem('dc_store', String(id));
  };

  const value = useMemo<Ctx>(
    () => ({
      session,
      loading,
      storeId,
      setStoreId,
      store: session?.stores.find((s) => s.id === storeId) ?? null,
      can: (...perms) => !!session && perms.some((p) => session.user.perms.includes(p)),
      login: async (tenant, username, password) => {
        const r = await api.post<Session & { token: string }>('/auth/login', { tenant, username, password });
        localStorage.setItem('dc_token', r.token);
        setSession(r);
      },
      logout: async () => {
        try {
          await api.post('/auth/logout');
        } catch {
          /* yoksay */
        }
        localStorage.removeItem('dc_token');
        setSession(null);
      },
      refresh,
      toast,
      toasts,
    }),
    [session, loading, storeId, refresh, toast, toasts],
  );
  return <C.Provider value={value}>{children}</C.Provider>;
}

export const useSession = () => useContext(C);

/** Veri yükleme kancası: yükleniyor / hata / yeniden yükle */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn()
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick((t) => t + 1), setData };
}
