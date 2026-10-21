import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { api, ApiError, type Cart, type Category, type Policy, type User } from "./api";

interface StoreState {
  user: User | null;
  /** False until the first "who am I" check has answered. */
  ready: boolean;
  categories: Category[];
  policy: Policy | null;
  cart: Cart | null;
  toast: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  setUser: (u: User) => void;
  refreshCart: () => Promise<void>;
  setQty: (slug: string, qty: number) => Promise<void>;
  notify: (message: string) => void;
}

const Ctx = createContext<StoreState | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [cart, setCart] = useState<Cart | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((t) => (t === message ? null : t)), 2600);
  }, []);

  const refreshCart = useCallback(async () => {
    try {
      setCart((await api<{ cart: Cart }>("/cart")).cart);
    } catch {
      setCart(null);
    }
  }, []);

  useEffect(() => {
    api<{ categories: Category[]; policy: Policy }>("/store")
      .then((s) => {
        setCategories(s.categories);
        setPolicy(s.policy);
      })
      .catch(() => undefined);
    api<{ user: User }>("/me")
      .then((r) => {
        setUser(r.user);
        return refreshCart();
      })
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, [refreshCart]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const r = await api<{ user: User }>("/auth/login", { method: "POST", body: { email, password } });
      setUser(r.user);
      await refreshCart();
    },
    [refreshCart],
  );

  const signUp = useCallback(
    async (name: string, email: string, password: string) => {
      const r = await api<{ user: User }>("/auth/signup", { method: "POST", body: { name, email, password } });
      setUser(r.user);
      await refreshCart();
    },
    [refreshCart],
  );

  const signOut = useCallback(async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    setUser(null);
    setCart(null);
  }, []);

  const setQty = useCallback(async (slug: string, qty: number) => {
    try {
      setCart((await api<{ cart: Cart }>(`/cart/${slug}`, { method: "PUT", body: { qty } })).cart);
    } catch (e) {
      throw e instanceof ApiError ? e : new ApiError(0, "ERROR", "Could not update your cart.");
    }
  }, []);

  const value = useMemo(
    () => ({ user, ready, categories, policy, cart, toast, signIn, signUp, signOut, setUser, refreshCart, setQty, notify }),
    [user, ready, categories, policy, cart, toast, signIn, signUp, signOut, refreshCart, setQty, notify],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): StoreState {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}
