import { useEffect, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { api, ApiError, day, money, type Address, type Order, type Product } from "../api";
import { useStore } from "../state";
import { Alert, Button, Card, Empty, Price, ProductCard, Spinner, Stars, Tile } from "../ui";

/** Products for a query; a result is kept with the query it answers, so a new query never shows the old one. */
function useProducts(query: string) {
  const [result, setResult] = useState<{ query: string; products?: Product[]; error?: string } | null>(null);
  useEffect(() => {
    let live = true;
    api<{ products: Product[] }>(`/products${query}`)
      .then((r) => live && setResult({ query, products: r.products }))
      .catch((e: ApiError) => live && setResult({ query, error: e.message }));
    return () => {
      live = false;
    };
  }, [query]);
  const current = result?.query === query ? result : null;
  return { products: current?.products ?? null, error: current?.error ?? null };
}

function Grid({ products }: { products: Product[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {products.map((p) => (
        <li key={p.slug}><ProductCard p={p} /></li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- home

export function HomePage() {
  const { categories, policy } = useStore();
  const { products } = useProducts("?sort=popular");
  const deals = products?.filter((p) => p.mrp - p.price >= p.mrp * 0.4).slice(0, 8) ?? [];
  return (
    <div className="space-y-10">
      <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-brand to-brand-dark px-6 py-10 text-white sm:px-10 sm:py-14">
        <div className="max-w-xl">
          <p className="text-sm font-semibold uppercase tracking-widest text-sun">Bunty Store</p>
          <h1 className="mt-3 text-4xl font-extrabold leading-tight sm:text-5xl">Shop more. Wait less.</h1>
          <p className="mt-4 text-lg text-white/85">
            Phones, fashion, books and groceries at your door. Pay on delivery, track every step, and return in{" "}
            {policy?.returnWindowDays ?? 7} days if it is not right.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/c/electronics"><Button variant="sun">Shop electronics</Button></Link>
            <Link to="/orders"><Button variant="ghost" className="border-white/40 !bg-transparent !text-white hover:!bg-white/10">Track an order</Button></Link>
          </div>
        </div>
      </section>

      <section aria-labelledby="cats">
        <h2 id="cats" className="mb-4 text-xl font-bold">Shop by category</h2>
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {categories.map((c, i) => (
            <li key={c.id}>
              <Link to={`/c/${c.id}`} className="flex flex-col items-center gap-2 rounded-2xl border border-line bg-surface p-4 text-center transition hover:border-brand-100 hover:bg-brand-50">
                <span className="tile h-16 w-16 text-4xl" style={{ ["--h" as string]: [220, 330, 30, 260, 350, 130][i] }} aria-hidden="true">{c.emoji}</span>
                <span className="text-sm font-semibold">{c.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="deals">
        <div className="mb-4 flex items-end justify-between">
          <h2 id="deals" className="text-xl font-bold">Today's best deals</h2>
          <Link to="/search?q=" className="text-sm font-semibold text-brand hover:underline">See all</Link>
        </div>
        {products ? <Grid products={deals} /> : <Spinner />}
      </section>

      <section className="grid gap-3 sm:grid-cols-3" aria-label="Why shop here">
        {[
          ["🚚", "Free delivery", `On orders over ${money(policy?.freeDeliveryFrom ?? 499)}`],
          ["💵", "Pay on delivery", "Pay only when your order arrives"],
          ["↩️", "Easy returns", `Return within ${policy?.returnWindowDays ?? 7} days of delivery`],
        ].map(([e, t, d]) => (
          <Card key={t} className="flex items-center gap-4">
            <span className="text-3xl" aria-hidden="true">{e}</span>
            <span><strong className="block">{t}</strong><span className="text-sm text-ink-2">{d}</span></span>
          </Card>
        ))}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- category and search

const SORTS = [
  ["popular", "Most popular"],
  ["price_low", "Price: low to high"],
  ["price_high", "Price: high to low"],
  ["rating", "Best rated"],
] as const;

export function ListingPage({ mode }: { mode: "category" | "search" }) {
  const { category } = useParams();
  const [params, setParams] = useSearchParams();
  const { categories } = useStore();
  const sort = params.get("sort") ?? "popular";
  const q = params.get("q") ?? "";
  const query =
    mode === "category"
      ? `?category=${encodeURIComponent(category ?? "")}&sort=${sort}`
      : `?q=${encodeURIComponent(q)}&sort=${sort}`;
  const { products, error } = useProducts(query);
  const title = mode === "category" ? (categories.find((c) => c.id === category)?.name ?? "Products") : q ? `Results for "${q}"` : "All products";
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
          {products && <p className="text-sm text-ink-3">{products.length} products</p>}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-ink-2">Sort by</span>
          <select
            value={sort}
            onChange={(e) => {
              params.set("sort", e.target.value);
              setParams(params, { replace: true });
            }}
            className="h-10 rounded-full border border-line bg-surface px-3"
          >
            {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>
      {error && <Alert>{error}</Alert>}
      {!products && !error && <Spinner />}
      {products && products.length === 0 && (
        <Empty emoji="🔎" title="No products found">Try a different word, or browse a category above.</Empty>
      )}
      {products && products.length > 0 && <Grid products={products} />}
    </div>
  );
}

// ---------------------------------------------------------------- product

export function ProductPage() {
  const { slug = "" } = useParams();
  // a new product is a new page: its quantity and loading state start fresh
  return <ProductView key={slug} slug={slug} />;
}

function ProductView({ slug }: { slug: string }) {
  const { user, setQty, cart, notify, policy } = useStore();
  const nav = useNavigate();
  const [data, setData] = useState<{ product: Product; related: Product[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qty, setQ] = useState(1);
  const [busy, setBusy] = useState(false);
  const [openedAt] = useState(() => Date.now());

  useEffect(() => {
    api<{ product: Product; related: Product[] }>(`/products/${slug}`).then(setData).catch((e: ApiError) => setError(e.message));
  }, [slug]);

  if (error) return <Empty emoji="🤷" title="Product not found"><Link to="/" className="text-brand underline">Back to the store</Link></Empty>;
  if (!data) return <Spinner />;
  const p = data.product;
  const inCart = cart?.lines.find((l) => l.product.slug === p.slug)?.qty ?? 0;
  const by = new Date(openedAt + p.deliveryDays * 24 * 60 * 60 * 1000);

  async function add(thenCheckout: boolean) {
    if (!user) {
      nav(`/signin?next=/p/${p.slug}`);
      return;
    }
    setBusy(true);
    try {
      await setQty(p.slug, Math.min(10, inCart + qty));
      if (thenCheckout) nav("/cart");
      else notify(`Added ${qty} × ${p.name.split(" ").slice(0, 3).join(" ")} to your cart`);
    } catch (e) {
      notify((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-10">
      <div className="grid gap-6 md:grid-cols-2 md:gap-10">
        <Tile emoji={p.emoji} hue={p.hue} size="lg" />
        <div>
          <h1 className="text-2xl font-bold leading-snug sm:text-3xl">{p.name}</h1>
          <div className="mt-2"><Stars rating={p.rating} count={p.ratingCount} /></div>
          <div className="mt-4"><Price p={p} big /></div>
          <p className="text-sm text-ink-3">Inclusive of all taxes</p>
          <p className="mt-4 text-ink-2">{p.description}</p>
          <ul className="mt-4 space-y-1.5">
            {p.highlights.map((h) => <li key={h} className="flex gap-2"><span className="text-ok" aria-hidden="true">✓</span>{h}</li>)}
          </ul>
          <Card className="mt-6 space-y-2 !p-4">
            <p><span aria-hidden="true">🚚 </span><strong>Delivery by {day(by)}</strong> · {(cart?.subtotal ?? 0) + p.price >= (policy?.freeDeliveryFrom ?? 499) ? "Free delivery" : `${money(policy?.deliveryFee ?? 40)} delivery under ${money(policy?.freeDeliveryFrom ?? 499)}`}</p>
            <p><span aria-hidden="true">{p.returnable ? "↩️ " : "🚫 "}</span>{p.returnable ? `${policy?.returnWindowDays ?? 7}-day easy return` : "Not returnable (grocery)"}</p>
            <p><span aria-hidden="true">💵 </span>Pay on delivery</p>
          </Card>
          {p.inStock ? (
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                Qty
                <select value={qty} onChange={(e) => setQ(Number(e.target.value))} className="h-11 rounded-full border border-line bg-surface px-3">
                  {Array.from({ length: 5 }, (_, i) => i + 1).map((n) => <option key={n}>{n}</option>)}
                </select>
              </label>
              <Button variant="sun" disabled={busy} onClick={() => void add(false)}>Add to cart</Button>
              <Button disabled={busy} onClick={() => void add(true)}>Buy now</Button>
            </div>
          ) : (
            <div className="mt-6"><Alert tone="warn">Out of stock right now.</Alert></div>
          )}
          {p.lowStock && <p className="mt-3 text-sm font-semibold text-warn">Only a few left — order soon.</p>}
          {inCart > 0 && <p className="mt-3 text-sm text-ink-2">{inCart} already in your <Link to="/cart" className="text-brand underline">cart</Link>.</p>}
        </div>
      </div>
      {data.related.length > 0 && (
        <section aria-labelledby="related">
          <h2 id="related" className="mb-4 text-xl font-bold">You may also like</h2>
          <Grid products={data.related} />
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- cart

export function CartPage() {
  const { ready, user, cart, setQty, notify, policy } = useStore();
  const nav = useNavigate();
  if (!ready) return <Spinner />;
  if (!user) return <Empty emoji="🛒" title="Sign in to see your cart"><Link to="/signin?next=/cart"><Button className="mt-2">Sign in</Button></Link></Empty>;
  if (!cart) return <Spinner />;
  if (cart.lines.length === 0)
    return <Empty emoji="🛒" title="Your cart is empty">Find something you like on the <Link to="/" className="text-brand underline">home page</Link>.</Empty>;
  const toFree = (policy?.freeDeliveryFrom ?? 499) - cart.subtotal;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div>
        <h1 className="mb-4 text-2xl font-bold">Your cart ({cart.count})</h1>
        <ul className="space-y-3">
          {cart.lines.map((l) => (
            <li key={l.product.slug}>
              <Card className="flex gap-4 !p-3">
                <Link to={`/p/${l.product.slug}`} className="w-24 shrink-0 sm:w-28"><Tile emoji={l.product.emoji} hue={l.product.hue} /></Link>
                <div className="flex min-w-0 flex-1 flex-col">
                  <Link to={`/p/${l.product.slug}`} className="font-medium hover:text-brand">{l.product.name}</Link>
                  <div className="mt-1"><Price p={l.product} /></div>
                  <div className="mt-auto flex items-center gap-3 pt-3">
                    <div className="flex items-center rounded-full border border-line">
                      <button type="button" className="h-9 w-9 rounded-full text-lg hover:bg-canvas" aria-label="One less" onClick={() => void setQty(l.product.slug, l.qty - 1).catch((e) => notify(e.message))}>−</button>
                      <span className="w-8 text-center font-semibold" aria-label={`Quantity ${l.qty}`}>{l.qty}</span>
                      <button type="button" className="h-9 w-9 rounded-full text-lg hover:bg-canvas disabled:opacity-40" disabled={l.qty >= 10} aria-label="One more" onClick={() => void setQty(l.product.slug, l.qty + 1).catch((e) => notify(e.message))}>+</button>
                    </div>
                    <button type="button" className="text-sm font-semibold text-ink-3 hover:text-bad" onClick={() => void setQty(l.product.slug, 0)}>Remove</button>
                    <span className="ml-auto font-bold">{money(l.lineTotal)}</span>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </div>
      <Summary cart={cart}>
        {toFree > 0 && <p className="text-sm text-ink-2">Add {money(toFree)} more for free delivery.</p>}
        <Button className="w-full" onClick={() => nav("/checkout")}>Proceed to checkout</Button>
      </Summary>
    </div>
  );
}

function Summary({ cart, children }: { cart: { subtotal: number; deliveryFee: number; total: number; count: number }; children?: ReactNode }) {
  return (
    <Card className="h-fit space-y-3 lg:sticky lg:top-4">
      <h2 className="text-lg font-bold">Order summary</h2>
      <dl className="space-y-1.5 text-[15px]">
        <div className="flex justify-between"><dt>Items ({cart.count})</dt><dd>{money(cart.subtotal)}</dd></div>
        <div className="flex justify-between"><dt>Delivery</dt><dd>{cart.deliveryFee ? money(cart.deliveryFee) : <span className="font-semibold text-ok">Free</span>}</dd></div>
        <div className="flex justify-between border-t border-line pt-2 text-lg font-bold"><dt>Total</dt><dd>{money(cart.total)}</dd></div>
      </dl>
      {children}
    </Card>
  );
}

// ---------------------------------------------------------------- checkout

export function AddressForm({ initial, onSaved, submitLabel }: { initial: Address | null; onSaved: (a: Address) => void; submitLabel: string }) {
  const [a, setA] = useState<Address>(initial ?? { name: "", phone: "", line1: "", city: "", state: "", pincode: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = (k: keyof Address, label: string, props: InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold">{label}</span>
      <input
        required
        value={a[k]}
        onChange={(e) => setA({ ...a, [k]: e.target.value })}
        className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-[15px] focus:border-brand"
        {...props}
      />
    </label>
  );
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const r = await api<{ address: Address }>("/me/address", { method: "PUT", body: a });
          onSaved(r.address);
        } catch (err) {
          setError((err as ApiError).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="sm:col-span-2">{field("name", "Full name", { autoComplete: "name" })}</div>
      {field("phone", "Mobile number", { inputMode: "numeric", autoComplete: "tel-national", placeholder: "10 digits" })}
      {field("pincode", "Pincode", { inputMode: "numeric", autoComplete: "postal-code", placeholder: "6 digits" })}
      <div className="sm:col-span-2">{field("line1", "House, street and area", { autoComplete: "street-address" })}</div>
      {field("city", "City", { autoComplete: "address-level2" })}
      {field("state", "State", { autoComplete: "address-level1" })}
      {error && <div className="sm:col-span-2"><Alert>{error}</Alert></div>}
      <div className="sm:col-span-2"><Button type="submit" disabled={busy}>{busy ? "Saving…" : submitLabel}</Button></div>
    </form>
  );
}

export function CheckoutPage() {
  const { ready, user, cart, setUser, refreshCart } = useStore();
  const nav = useNavigate();
  // the form shows while editing, or whenever there is no saved address yet
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!ready) return <Spinner />;
  if (!user) return <Empty emoji="🔐" title="Please sign in to check out"><Link to="/signin?next=/checkout"><Button className="mt-2">Sign in</Button></Link></Empty>;
  if (!cart) return <Spinner />;
  if (cart.lines.length === 0) return <Empty emoji="🛒" title="Your cart is empty"><Link to="/" className="text-brand underline">Keep shopping</Link></Empty>;

  async function place() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ order: Order }>("/orders", { method: "POST" });
      await refreshCart();
      nav(`/order-placed/${r.order.number}`, { replace: true });
    } catch (e) {
      setError((e as ApiError).message);
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Checkout</h1>
        <Card>
          <h2 className="mb-3 text-lg font-bold">1. Delivery address</h2>
          {editing || !user.address ? (
            <AddressForm
              initial={user.address}
              submitLabel="Deliver here"
              onSaved={(address) => {
                setUser({ ...user, address });
                setEditing(false);
              }}
            />
          ) : (
            <div className="flex items-start justify-between gap-4">
              <address className="not-italic text-ink-2">
                <strong className="text-ink">{user.address.name}</strong><br />
                {user.address.line1}, {user.address.city}, {user.address.state} {user.address.pincode}<br />
                📞 {user.address.phone}
              </address>
              <button type="button" className="text-sm font-semibold text-brand hover:underline" onClick={() => setEditing(true)}>Change</button>
            </div>
          )}
        </Card>
        <Card>
          <h2 className="mb-3 text-lg font-bold">2. Payment</h2>
          <label className="flex items-start gap-3 rounded-xl border-2 border-brand bg-brand-50 p-4">
            <input type="radio" checked readOnly className="mt-1 accent-brand" />
            <span>
              <strong>Pay on delivery</strong>
              <span className="block text-sm text-ink-2">This is a demo store: no money is taken and nothing is really shipped.</span>
            </span>
          </label>
        </Card>
        <Card>
          <h2 className="mb-3 text-lg font-bold">3. Items</h2>
          <ul className="divide-y divide-line">
            {cart.lines.map((l) => (
              <li key={l.product.slug} className="flex items-center gap-3 py-2">
                <Tile emoji={l.product.emoji} hue={l.product.hue} size="sm" />
                <span className="flex-1">{l.product.name} <span className="text-ink-3">× {l.qty}</span></span>
                <span className="font-semibold">{money(l.lineTotal)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Summary cart={cart}>
        {error && <Alert>{error}</Alert>}
        <Button className="w-full" variant="sun" disabled={busy || editing || !user.address} onClick={() => void place()}>
          {busy ? "Placing your order…" : "Place order"}
        </Button>
        {(editing || !user.address) && <p className="text-sm text-ink-3">Save your address to continue.</p>}
      </Summary>
    </div>
  );
}

export function OrderPlacedPage() {
  const { number } = useParams();
  const [order, setOrder] = useState<Order | null>(null);
  useEffect(() => {
    api<{ order: Order }>(`/orders/${number}`).then((r) => setOrder(r.order)).catch(() => undefined);
  }, [number]);
  return (
    <div className="mx-auto max-w-lg py-10 text-center">
      <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-ok-50 text-4xl text-ok" aria-hidden="true">✓</div>
      <h1 className="mt-5 text-3xl font-bold">Order placed!</h1>
      <p className="mt-2 text-ink-2">Thank you. Your order number is</p>
      <p className="mt-1 font-mono text-2xl font-bold tracking-wider">{number}</p>
      {order && <p className="mt-3 text-ink-2">Expected delivery: <strong>{day(order.expectedDelivery)}</strong> · Total {money(order.total)} (pay on delivery)</p>}
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link to={`/orders/${number}`}><Button>Track this order</Button></Link>
        <Link to="/"><Button variant="ghost">Keep shopping</Button></Link>
      </div>
    </div>
  );
}
