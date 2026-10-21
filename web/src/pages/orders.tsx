import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { api, ApiError, dateTime, day, money, type Order } from "../api";
import { useStore } from "../state";
import { Alert, Button, Card, Empty, Modal, Spinner, StatusChip, Tile, Tracker } from "../ui";
import { AddressForm } from "./shop";

function SignInFirst({ next }: { next: string }) {
  return (
    <Empty emoji="🔐" title="Please sign in">
      <Link to={`/signin?next=${encodeURIComponent(next)}`}><Button className="mt-2">Sign in</Button></Link>
    </Empty>
  );
}

// ---------------------------------------------------------------- your orders

export function OrdersPage() {
  const { ready, user } = useStore();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!user) return;
    api<{ orders: Order[] }>("/orders").then((r) => setOrders(r.orders)).catch((e: ApiError) => setError(e.message));
  }, [user]);
  if (!ready) return <Spinner />;
  if (!user) return <SignInFirst next="/orders" />;
  if (error) return <Alert>{error}</Alert>;
  if (!orders) return <Spinner />;
  if (orders.length === 0) return <Empty emoji="📦" title="No orders yet">When you place an order, it will show here.</Empty>;
  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Your orders</h1>
      <ul className="space-y-3">
        {orders.map((o) => {
          const label = o.return ? o.return.statusLabel : o.statusLabel;
          const tone = o.return ? o.return.status : o.status;
          return (
            <li key={o.number}>
              <Link to={`/orders/${o.number}`} className="block rounded-[var(--radius-card)] border border-line bg-surface p-4 transition hover:border-brand-100">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm text-ink-3">
                    Order <span className="font-mono font-semibold text-ink">{o.number}</span> · {day(o.placedAt)}
                  </div>
                  <StatusChip status={tone} label={label} />
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <div className="flex -space-x-3">
                    {o.items.slice(0, 4).map((i) => <Tile key={i.slug} emoji={i.emoji} hue={i.hue} size="sm" className="ring-2 ring-surface" />)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{o.items.map((i) => i.name).join(", ")}</p>
                    <p className="text-sm text-ink-2">
                      {o.status === "delivered" && o.deliveredAt ? `Delivered ${day(o.deliveredAt)}` : o.status === "cancelled" ? "Cancelled" : `Arriving by ${day(o.expectedDelivery)}`}
                    </p>
                  </div>
                  <span className="font-bold">{money(o.total)}</span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- one order

export function OrderDetailPage() {
  const { number } = useParams();
  const { ready, user, policy, notify } = useStore();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"cancel" | "return" | null>(null);

  const load = useCallback(() => {
    api<{ order: Order }>(`/orders/${number}`).then((r) => setOrder(r.order)).catch((e: ApiError) => setError(e.message));
  }, [number]);
  useEffect(() => {
    if (user) load();
  }, [user, load]);

  if (!ready) return <Spinner />;
  if (!user) return <SignInFirst next={`/orders/${number}`} />;
  if (error) return <Empty emoji="🤷" title="Order not found"><Link to="/orders" className="text-brand underline">See your orders</Link></Empty>;
  if (!order) return <Spinner />;

  const times = Object.fromEntries(order.timeline.map((e) => [e.status, e.at]));

  return (
    <div className="space-y-4">
      <Link to="/orders" className="text-sm font-semibold text-brand hover:underline">← Your orders</Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Order <span className="font-mono">{order.number}</span></h1>
          <p className="text-sm text-ink-3">Placed {dateTime(order.placedAt)}</p>
        </div>
        <StatusChip status={order.status} label={order.statusLabel} />
      </div>

      <Card>
        {order.status === "cancelled" ? (
          <div className="space-y-1">
            <p className="text-lg font-bold text-bad">This order was cancelled</p>
            <p className="text-ink-2">
              {order.cancel ? `On ${dateTime(order.cancel.at)} · Reason: ${order.cancel.reason}` : null}
            </p>
            <p className="text-sm text-ink-2">Nothing was charged, because payment is taken on delivery.</p>
          </div>
        ) : (
          <>
            <p className="mb-4 text-lg font-bold">
              {order.status === "delivered" && order.deliveredAt ? `Delivered on ${day(order.deliveredAt)}` : `Arriving by ${day(order.expectedDelivery)}`}
            </p>
            <Tracker status={order.status} times={times} />
          </>
        )}
      </Card>

      {order.return && (
        <Card className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold">Return</h2>
            <StatusChip status={order.return.status} label={order.return.statusLabel} />
          </div>
          <p className="text-ink-2">Reason: {order.return.reason}{order.return.details ? ` — "${order.return.details}"` : ""}</p>
          <ol className="space-y-1 text-sm">
            {order.return.timeline.map((e) => (
              <li key={e.status + e.at} className="flex gap-2"><span className="text-ok" aria-hidden="true">●</span>{label(e.status)} · {dateTime(e.at)}{e.note && e.status === "rejected" ? ` — ${e.note}` : ""}</li>
            ))}
          </ol>
          {order.refund && (
            <Alert tone={order.refund.status === "completed" ? "ok" : "warn"}>
              {order.refund.status === "completed"
                ? `Refund of ${money(order.refund.amount)} completed${order.refund.at ? ` on ${day(order.refund.at)}` : ""}.`
                : `Refund of ${money(order.refund.amount)} will be completed within 2 days of pickup.`}
            </Alert>
          )}
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-[1fr_18rem]">
        <Card>
          <h2 className="mb-2 text-lg font-bold">Items</h2>
          <ul className="divide-y divide-line">
            {order.items.map((i) => (
              <li key={i.slug} className="flex items-center gap-3 py-3">
                <Link to={`/p/${i.slug}`}><Tile emoji={i.emoji} hue={i.hue} size="sm" /></Link>
                <span className="flex-1">
                  <Link to={`/p/${i.slug}`} className="font-medium hover:text-brand">{i.name}</Link>
                  <span className="block text-sm text-ink-3">Qty {i.qty}{!i.returnable && " · Not returnable"}</span>
                </span>
                <span className="font-semibold">{money(i.price * i.qty)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-3 space-y-1 border-t border-line pt-3 text-[15px]">
            <div className="flex justify-between"><dt>Items</dt><dd>{money(order.subtotal)}</dd></div>
            <div className="flex justify-between"><dt>Delivery</dt><dd>{order.deliveryFee ? money(order.deliveryFee) : "Free"}</dd></div>
            <div className="flex justify-between font-bold"><dt>Total (pay on delivery)</dt><dd>{money(order.total)}</dd></div>
          </dl>
        </Card>
        <div className="space-y-4">
          <Card>
            <h2 className="mb-2 font-bold">Delivery address</h2>
            <address className="text-sm not-italic text-ink-2">
              <strong className="text-ink">{order.address.name}</strong><br />
              {order.address.line1}, {order.address.city}, {order.address.state} {order.address.pincode}<br />
              📞 {order.address.phone}
            </address>
          </Card>
          <Card className="space-y-3">
            <h2 className="font-bold">Need help with this order?</h2>
            {order.canCancel && <Button variant="danger" className="w-full" onClick={() => setDialog("cancel")}>Cancel order</Button>}
            {order.canReturn && (
              <>
                <Button variant="ghost" className="w-full" onClick={() => setDialog("return")}>Return items</Button>
                {order.returnDeadline && <p className="text-xs text-ink-3">Return by {day(order.returnDeadline)}.</p>}
              </>
            )}
            {!order.canCancel && !order.canReturn && order.returnBlockedReason && !order.return && order.status !== "cancelled" && (
              <p className="text-sm text-ink-2">{order.returnBlockedReason}</p>
            )}
            <p className="text-xs text-ink-3">Questions? Chat with us using the support button.</p>
          </Card>
        </div>
      </div>

      {dialog && (
        <ReasonDialog
          kind={dialog}
          reasons={dialog === "cancel" ? (policy?.cancelReasons ?? []) : (policy?.returnReasons ?? [])}
          onClose={() => setDialog(null)}
          onSubmit={async (reason, details) => {
            const path = dialog === "cancel" ? "cancel" : "return";
            const r = await api<{ order: Order }>(`/orders/${order.number}/${path}`, {
              method: "POST",
              body: dialog === "cancel" ? { reason } : { reason, details },
            });
            setOrder(r.order);
            setDialog(null);
            notify(dialog === "cancel" ? "Your order is cancelled" : "Return requested — we will pick it up soon");
          }}
        />
      )}
    </div>
  );
}

function label(status: string) {
  return ({ requested: "Return requested", approved: "Approved", picked_up: "Picked up", refunded: "Refunded", rejected: "Not accepted" } as Record<string, string>)[status] ?? status;
}

function ReasonDialog({
  kind,
  reasons,
  onClose,
  onSubmit,
}: {
  kind: "cancel" | "return";
  reasons: string[];
  onClose: () => void;
  onSubmit: (reason: string, details: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={kind === "cancel" ? "Cancel this order?" : "Return this order"} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!reason) return setError("Please choose a reason.");
          setBusy(true);
          setError(null);
          try {
            await onSubmit(reason, details);
          } catch (err) {
            setError((err as ApiError).message);
            setBusy(false);
          }
        }}
      >
        <fieldset className="space-y-2">
          <legend className="mb-2 font-semibold">Why {kind === "cancel" ? "are you cancelling" : "are you returning it"}?</legend>
          {reasons.map((r) => (
            <label key={r} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${reason === r ? "border-brand bg-brand-50" : "border-line"}`}>
              <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="accent-brand" />
              {r}
            </label>
          ))}
        </fieldset>
        {kind === "return" && (
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">Tell us more (optional)</span>
            <textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={500} rows={3} className="w-full rounded-xl border border-line p-3" />
          </label>
        )}
        {kind === "cancel" && <p className="text-sm text-ink-2">Nothing has been charged, so there is nothing to refund.</p>}
        {kind === "return" && <p className="text-sm text-ink-2">We will pick it up from your address. Your refund is completed within 2 days of pickup.</p>}
        {error && <Alert>{error}</Alert>}
        <div className="flex gap-3">
          <Button type="submit" variant={kind === "cancel" ? "danger" : "primary"} disabled={busy}>
            {busy ? "Please wait…" : kind === "cancel" ? "Yes, cancel order" : "Request return"}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>Keep order</Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- sign in / sign up / account

export function AuthPage({ mode }: { mode: "signin" | "signup" }) {
  const { user, signIn, signUp } = useStore();
  const [params] = useSearchParams();
  const next = params.get("next")?.startsWith("/") ? params.get("next")! : "/";
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (user) nav(next, { replace: true });
  }, [user, next, nav]);
  const input = "h-12 w-full rounded-xl border border-line bg-surface px-3 text-[15px] focus:border-brand";
  return (
    <div className="mx-auto max-w-sm py-6">
      <Card className="!p-6">
        <h1 className="text-2xl font-bold">{mode === "signin" ? "Sign in" : "Create your account"}</h1>
        <p className="mt-1 text-sm text-ink-2">{mode === "signin" ? "Welcome back to Bunty Store." : "It takes less than a minute."}</p>
        <form
          className="mt-5 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              if (mode === "signin") await signIn(email, password);
              else await signUp(name, email, password);
            } catch (err) {
              setError((err as ApiError).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {mode === "signup" && (
            <label className="block"><span className="mb-1 block text-sm font-semibold">Your name</span>
              <input required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className={input} />
            </label>
          )}
          <label className="block"><span className="mb-1 block text-sm font-semibold">Email</span>
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className={input} />
          </label>
          <label className="block"><span className="mb-1 block text-sm font-semibold">Password</span>
            <input required type="password" minLength={mode === "signup" ? 8 : 1} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signin" ? "current-password" : "new-password"} className={input} />
            {mode === "signup" && <span className="mt-1 block text-xs text-ink-3">At least 8 characters.</span>}
          </label>
          {error && <Alert>{error}</Alert>}
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}</Button>
        </form>
        <p className="mt-5 text-center text-sm text-ink-2">
          {mode === "signin" ? (
            <>New here? <Link to={`/signup?next=${encodeURIComponent(next)}`} className="font-semibold text-brand hover:underline">Create an account</Link></>
          ) : (
            <>Already have an account? <Link to={`/signin?next=${encodeURIComponent(next)}`} className="font-semibold text-brand hover:underline">Sign in</Link></>
          )}
        </p>
      </Card>
    </div>
  );
}

export function AccountPage() {
  const { ready, user, setUser, notify } = useStore();
  if (!ready) return <Spinner />;
  if (!user) return <SignInFirst next="/account" />;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">Your account</h1>
      <Card>
        <p className="font-semibold">{user.name}</p>
        <p className="text-ink-2">{user.email}</p>
      </Card>
      <Card>
        <h2 className="mb-3 text-lg font-bold">Delivery address</h2>
        <AddressForm
          initial={user.address}
          submitLabel="Save address"
          onSaved={(address) => {
            setUser({ ...user, address });
            notify("Address saved");
          }}
        />
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- store team

const FILTERS = [
  ["", "All"],
  ["placed", "New"],
  ["packed", "Packed"],
  ["shipped", "Shipped"],
  ["out_for_delivery", "Out for delivery"],
  ["delivered", "Delivered"],
  ["returns", "Returns"],
  ["cancelled", "Cancelled"],
] as const;

const NEXT_LABEL: Record<string, string> = {
  placed: "Mark packed",
  packed: "Mark shipped",
  shipped: "Out for delivery",
  out_for_delivery: "Mark delivered",
};
const RETURN_NEXT: Record<string, string> = { requested: "Approve return", approved: "Mark picked up", picked_up: "Complete refund" };

export function AdminPage() {
  const { ready, user, notify } = useStore();
  const [filter, setFilter] = useState("");
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<{ orders: Order[] }>(`/admin/orders${filter ? `?status=${filter}` : ""}`).then((r) => setOrders(r.orders)).catch((e: ApiError) => setError(e.message));
  }, [filter]);
  useEffect(() => {
    if (user?.role === "admin") load();
  }, [user, load]);
  if (!ready) return <Spinner />;
  if (!user) return <SignInFirst next="/admin" />;
  if (user.role !== "admin") return <Empty emoji="🚫" title="Only the store team can open this page" />;

  async function act(path: string, done: string) {
    try {
      await api(path, { method: "POST" });
      notify(done);
      load();
    } catch (e) {
      notify((e as ApiError).message);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Store team · Orders</h1>
        <p className="text-sm text-ink-2">Move orders and returns forward to show customers (and Serviqo) every step.</p>
      </div>
      <div className="no-scrollbar flex gap-2 overflow-x-auto">
        {FILTERS.map(([v, l]) => (
          <button key={v} type="button" onClick={() => setFilter(v)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${filter === v ? "bg-brand text-white" : "border border-line bg-surface"}`}>
            {l}
          </button>
        ))}
      </div>
      {error && <Alert>{error}</Alert>}
      {!orders ? <Spinner /> : orders.length === 0 ? <Empty emoji="📭" title="No orders here" /> : (
        <ul className="space-y-3">
          {orders.map((o) => (
            <li key={o.number}>
              <Card className="space-y-3 !p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-mono font-bold">{o.number}</p>
                    <p className="text-sm text-ink-3">{o.customer?.name} · {o.customer?.email} · {dateTime(o.placedAt)}</p>
                  </div>
                  <div className="flex gap-2">
                    <StatusChip status={o.status} label={o.statusLabel} />
                    {o.return && <StatusChip status={o.return.status} label={o.return.statusLabel} />}
                  </div>
                </div>
                <p className="text-sm">{o.items.map((i) => `${i.emoji} ${i.name} × ${i.qty}`).join(" · ")} — <strong>{money(o.total)}</strong></p>
                <div className="flex flex-wrap gap-2">
                  {NEXT_LABEL[o.status] && <Button className="!min-h-9 !px-4 !text-sm" onClick={() => void act(`/admin/orders/${o.number}/advance`, `${o.number}: ${NEXT_LABEL[o.status]}`)}>{NEXT_LABEL[o.status]}</Button>}
                  {o.return && RETURN_NEXT[o.return.status] && (
                    <Button variant="sun" className="!min-h-9 !px-4 !text-sm" onClick={() => void act(`/admin/orders/${o.number}/return/advance`, `${o.number}: ${RETURN_NEXT[o.return!.status]}`)}>{RETURN_NEXT[o.return.status]}</Button>
                  )}
                  {o.return?.status === "requested" && (
                    <Button
                      variant="danger"
                      className="!min-h-9 !px-4 !text-sm"
                      onClick={async () => {
                        const note = window.prompt("Why is this return not accepted?");
                        if (!note) return;
                        try {
                          await api(`/admin/orders/${o.number}/return/reject`, { method: "POST", body: { note } });
                          notify(`${o.number}: return declined`);
                          load();
                        } catch (e) {
                          notify((e as ApiError).message);
                        }
                      }}
                    >
                      Decline return
                    </Button>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
