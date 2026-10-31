import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link, NavLink, useNavigate, useSearchParams } from "react-router-dom";

import { money, percentOff, type Product } from "./api";
import { useStore } from "./state";

// ---------------------------------------------------------------- small pieces

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "sun" | "ghost" | "danger" }) {
  const styles = {
    primary: "bg-brand text-white hover:bg-brand-dark",
    sun: "bg-sun text-ink hover:brightness-95",
    ghost: "bg-surface text-ink border border-line hover:bg-canvas",
    danger: "bg-surface text-bad border border-bad/40 hover:bg-bad-50",
  }[variant];
  return (
    <button
      {...props}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-[15px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${styles} ${className}`}
    />
  );
}

export function Tile({ emoji, hue, size = "md", className = "" }: { emoji: string; hue: number; size?: "sm" | "md" | "lg"; className?: string }) {
  const s = { sm: "h-14 w-14 text-3xl", md: "aspect-square w-full text-6xl", lg: "aspect-square w-full text-[9rem]" }[size];
  return (
    <div className={`tile ${s} ${className}`} style={{ ["--h" as string]: hue }} aria-hidden="true">
      <span className="drop-shadow-sm">{emoji}</span>
    </div>
  );
}

export function Stars({ rating, count }: { rating: number; count?: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className="inline-flex items-center gap-1 rounded-md bg-ok px-1.5 py-0.5 text-xs font-bold text-white">
        {rating.toFixed(1)} ★
      </span>
      {count !== undefined && <span className="text-ink-3">({count.toLocaleString("en-IN")})</span>}
    </span>
  );
}

export function Price({ p, big = false }: { p: { price: number; mrp: number }; big?: boolean }) {
  const off = percentOff(p);
  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <span className={big ? "text-3xl font-bold" : "text-lg font-bold"}>{money(p.price)}</span>
      {off > 0 && (
        <>
          <span className="text-sm text-ink-3 line-through">{money(p.mrp)}</span>
          <span className={`font-semibold text-ok ${big ? "text-base" : "text-sm"}`}>{off}% off</span>
        </>
      )}
    </span>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 py-16 text-ink-3">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-brand-100 border-t-brand" />
      {label}…
    </div>
  );
}

export function Empty({ emoji, title, children }: { emoji: string; title: string; children?: ReactNode }) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <div className="text-6xl" aria-hidden="true">{emoji}</div>
      <h2 className="mt-4 text-xl font-bold">{title}</h2>
      {children && <div className="mt-3 text-ink-2">{children}</div>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-[var(--radius-card)] border border-line bg-surface p-5 ${className}`}>{children}</section>;
}

export function Alert({ tone = "bad", children }: { tone?: "bad" | "ok" | "warn"; children: ReactNode }) {
  const t = { bad: "bg-bad-50 text-bad", ok: "bg-ok-50 text-ok", warn: "bg-warn-50 text-warn" }[tone];
  return (
    <p role={tone === "bad" ? "alert" : "status"} className={`rounded-xl px-4 py-3 text-sm font-medium ${t}`}>
      {children}
    </p>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="m-auto w-[min(100%-2rem,30rem)] rounded-2xl border border-line bg-surface p-0 text-ink backdrop:bg-ink/50"
      aria-label={title}
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 className="text-lg font-bold">{title}</h2>
        <button type="button" onClick={onClose} className="rounded-full p-2 text-ink-3 hover:bg-canvas" aria-label="Close">
          ✕
        </button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  );
}

// ---------------------------------------------------------------- product card

export function ProductCard({ p }: { p: Product }) {
  return (
    <Link
      to={`/p/${p.slug}`}
      className="group flex flex-col rounded-[var(--radius-card)] border border-line bg-surface p-3 transition hover:-translate-y-0.5 hover:border-brand-100 hover:shadow-[0_8px_24px_-12px_rgba(27,27,47,0.25)]"
    >
      <div className="relative">
        <Tile emoji={p.emoji} hue={p.hue} />
        {percentOff(p) >= 30 && (
          <span className="absolute left-2 top-2 rounded-full bg-sun px-2 py-0.5 text-xs font-bold text-ink">Deal</span>
        )}
      </div>
      <h3 className="mt-3 line-clamp-2 min-h-[2.75rem] text-[15px] font-medium leading-snug group-hover:text-brand">{p.name}</h3>
      <div className="mt-2"><Price p={p} /></div>
      {!p.inStock && <span className="mt-1 text-sm font-semibold text-bad">Out of stock</span>}
    </Link>
  );
}

// ---------------------------------------------------------------- order tracker

const STEPS = [
  ["placed", "Ordered"],
  ["packed", "Packed"],
  ["shipped", "Shipped"],
  ["out_for_delivery", "Out for delivery"],
  ["delivered", "Delivered"],
] as const;

export function Tracker({ status, times }: { status: string; times: Record<string, string> }) {
  const reached = STEPS.findIndex(([s]) => s === status);
  return (
    <ol className="grid grid-cols-5 gap-1" aria-label="Order progress">
      {STEPS.map(([s, label], i) => {
        const done = i <= reached;
        return (
          <li key={s} className="relative flex flex-col items-center text-center">
            {i > 0 && (
              <span className={`absolute right-1/2 top-3 h-1 w-full -translate-y-1/2 ${i <= reached ? "bg-ok" : "bg-line"}`} aria-hidden="true" />
            )}
            <span
              className={`relative z-10 grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${done ? "bg-ok text-white" : "border-2 border-line bg-surface text-ink-3"}`}
              aria-hidden="true"
            >
              {done ? "✓" : i + 1}
            </span>
            <span className={`mt-2 text-xs sm:text-sm ${done ? "font-semibold text-ink" : "text-ink-3"}`}>
              {label}
              <span className="sr-only">{done ? " (done)" : " (not yet)"}</span>
            </span>
            {times[s] && <span className="text-[11px] text-ink-3 sm:text-xs">{new Date(times[s]!).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>}
          </li>
        );
      })}
    </ol>
  );
}

export function StatusChip({ status, label }: { status: string; label: string }) {
  const tone =
    status === "delivered" || status === "refunded"
      ? "bg-ok-50 text-ok"
      : status === "cancelled" || status === "rejected"
        ? "bg-bad-50 text-bad"
        : "bg-brand-50 text-brand-dark";
  return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${tone}`}>{label}</span>;
}

// ---------------------------------------------------------------- layout

function SearchBox({ className = "" }: { className?: string }) {
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const nav = useNavigate();
  return (
    <form
      role="search"
      className={`flex h-11 overflow-hidden rounded-full bg-surface ring-1 ring-white/30 ${className}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim()) nav(`/search?q=${encodeURIComponent(q.trim())}`);
      }}
    >
      <label className="sr-only" htmlFor="site-search">Search products</label>
      <input
        id="site-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search phones, shoes, books…"
        className="min-w-0 flex-1 px-4 text-[15px] text-ink outline-none placeholder:text-ink-3"
      />
      <button type="submit" className="bg-sun px-4 font-semibold text-ink" aria-label="Search">
        🔍
      </button>
    </form>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, cart, categories, toast, signOut } = useStore();
  const [menu, setMenu] = useState(false);
  const nav = useNavigate();
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:p-3">
        Skip to content
      </a>
      <header className="bg-brand text-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Link to="/" className="flex shrink-0 items-center gap-2" aria-label="Bunty Store home">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-sun text-xl font-black text-ink">B</span>
            <span className="text-xl font-extrabold tracking-tight">bunty<span className="text-sun">store</span></span>
          </Link>
          <SearchBox className="ml-2 hidden flex-1 md:flex" />
          <nav className="ml-auto flex items-center gap-1 sm:gap-2" aria-label="Account">
            {user ? (
              <div className="relative">
                <button
                  type="button"
                  className="rounded-full px-3 py-2 text-left text-sm leading-tight hover:bg-white/10"
                  aria-expanded={menu}
                  onClick={() => setMenu((m) => !m)}
                >
                  <span className="block text-[11px] text-white/80">Hello, {user.name.split(" ")[0]}</span>
                  <span className="font-semibold">Account ▾</span>
                </button>
                {menu && (
                  <div className="absolute right-0 z-30 mt-2 w-48 overflow-hidden rounded-xl border border-line bg-surface text-ink shadow-lg" onClick={() => setMenu(false)}>
                    <Link to="/orders" className="block px-4 py-3 hover:bg-canvas">Your orders</Link>
                    <Link to="/account" className="block px-4 py-3 hover:bg-canvas">Your address</Link>
                    {user.role === "admin" && <Link to="/admin" className="block px-4 py-3 hover:bg-canvas">Store team</Link>}
                    <button
                      type="button"
                      className="block w-full border-t border-line px-4 py-3 text-left hover:bg-canvas"
                      onClick={() => void signOut().then(() => nav("/"))}
                    >
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Link to="/signin" className="rounded-full px-3 py-2 text-sm font-semibold hover:bg-white/10">Sign in</Link>
            )}
            {user && (
              <Link to="/orders" className="hidden rounded-full px-3 py-2 text-sm font-semibold hover:bg-white/10 sm:block">Orders</Link>
            )}
            <Link to="/cart" className="relative flex items-center gap-1 rounded-full px-3 py-2 font-semibold hover:bg-white/10" aria-label={`Cart, ${cart?.count ?? 0} items`}>
              <span className="text-2xl" aria-hidden="true">🛒</span>
              <span className="hidden sm:inline">Cart</span>
              {(cart?.count ?? 0) > 0 && (
                <span className="absolute -top-0.5 left-7 grid h-5 min-w-5 place-items-center rounded-full bg-sun px-1 text-xs font-bold text-ink">{cart!.count}</span>
              )}
            </Link>
          </nav>
        </div>
        <div className="px-4 pb-3 md:hidden"><SearchBox /></div>
      </header>
      <nav className="no-scrollbar overflow-x-auto border-b border-line bg-surface" aria-label="Categories">
        <ul className="mx-auto flex max-w-6xl gap-1 px-2 py-1.5">
          {categories.map((c) => (
            <li key={c.id} className="shrink-0">
              <NavLink
                to={`/c/${c.id}`}
                className={({ isActive }) => `flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium ${isActive ? "bg-brand-50 text-brand-dark" : "text-ink-2 hover:bg-canvas"}`}
              >
                <span aria-hidden="true">{c.emoji}</span>
                {c.name}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
      <footer className="border-t border-line bg-surface">
        {/* bottom room on phones so the round chat button never covers the last line */}
        <div className="mx-auto grid max-w-6xl gap-2 px-4 pt-6 pb-24 text-sm text-ink-3 sm:flex sm:justify-between sm:pb-6">
          <span>© Bunty Store</span>
          <span>Pay on delivery · {7}-day returns · Free delivery over ₹499</span>
        </div>
      </footer>
      {toast && (
        <div role="status" className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-5 py-3 text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
