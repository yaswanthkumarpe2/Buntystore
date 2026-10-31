import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { api, ApiError, type Cart, type Category, type Policy, type User } from "./api";
import { loadServiqoChat, type ChatSetup } from "./chat";

interface StoreState {
  user: User | null;
  /** False until the first "who am I" check has answered. */
  ready: boolean;
  categories: Category[];
  policy: Policy | null;
  /** True when the store can email a password reset link. */
  passwordReset: boolean;
  /** True when the store can email sign-in codes. */
  emailSignIn: boolean;
  /** True when "Continue with Google" is set up. */
  googleSignIn: boolean;
  cart: Cart | null;
  toast: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  /** Emails a sign-in code; answers how many seconds until another can be sent. */
  sendCode: (email: string) => Promise<number>;
  /** Checks the code; "name" means it was right but a new account needs a name first. */
  verifyCode: (email: string, code: string, name?: string) => Promise<"signed-in" | "name">;
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
  const [passwordReset, setPasswordReset] = useState(false);
  const [emailSignIn, setEmailSignIn] = useState(false);
  const [googleSignIn, setGoogleSignIn] = useState(false);
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
    api<{ categories: Category[]; policy: Policy; chat: ChatSetup | null; passwordReset: boolean; emailSignIn: boolean; googleSignIn: boolean }>(
      "/store",
    )
      .then((s) => {
        setCategories(s.categories);
        setPolicy(s.policy);
        setPasswordReset(s.passwordReset);
        setEmailSignIn(s.emailSignIn);
        setGoogleSignIn(s.googleSignIn);
        loadServiqoChat(s.chat);
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

  const sendCode = useCallback(async (email: string) => {
    const r = await api<{ resendIn: number }>("/auth/code", { method: "POST", body: { email } });
    return r.resendIn;
  }, []);

  const verifyCode = useCallback(
    async (email: string, code: string, name?: string): Promise<"signed-in" | "name"> => {
      const r = await api<{ user?: User; needsName?: boolean }>("/auth/code/verify", { method: "POST", body: { email, code, name } });
      if (r.needsName || !r.user) return "name";
      setUser(r.user);
      await refreshCart();
      return "signed-in";
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
    () => ({
      user,
      ready,
      categories,
      policy,
      passwordReset,
      emailSignIn,
      googleSignIn,
      cart,
      toast,
      signIn,
      sendCode,
      verifyCode,
      signOut,
      setUser,
      refreshCart,
      setQty,
      notify,
    }),
    [user, ready, categories, policy, passwordReset, emailSignIn, googleSignIn, cart, toast, signIn, sendCode, verifyCode, signOut, refreshCart, setQty, notify],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): StoreState {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}
