/** Calls the store's API; a failure throws an ApiError carrying the server's plain-words message. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? "GET",
      credentials: "same-origin",
      headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "OFFLINE", "Could not reach Bunty Store. Check your internet and try again.");
  }
  const data = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code ?? "ERROR", data?.error?.message ?? "Something went wrong. Please try again.");
  }
  return data as T;
}

// ---------------------------------------------------------------- shapes

export interface Category {
  id: string;
  name: string;
  emoji: string;
}

export interface Policy {
  returnWindowDays: number;
  freeDeliveryFrom: number;
  deliveryFee: number;
  cancelReasons: string[];
  returnReasons: string[];
}

export interface Product {
  slug: string;
  name: string;
  category: string;
  price: number;
  mrp: number;
  emoji: string;
  hue: number;
  description: string;
  highlights: string[];
  rating: number;
  ratingCount: number;
  inStock: boolean;
  lowStock: boolean;
  returnable: boolean;
  deliveryDays: number;
}

export interface Address {
  name: string;
  phone: string;
  line1: string;
  city: string;
  state: string;
  pincode: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: "customer" | "admin";
  address: Address | null;
  /** Whether the account can also sign in with a password. */
  hasPassword: boolean;
  /** Whether the account is joined to a Google account. */
  google: boolean;
}

export interface Cart {
  lines: { product: Product; qty: number; lineTotal: number }[];
  count: number;
  subtotal: number;
  deliveryFee: number;
  total: number;
}

export interface TimelineEvent {
  status: string;
  at: string;
  note: string;
}

export interface Order {
  number: string;
  placedAt: string;
  items: { slug: string; name: string; emoji: string; hue: number; price: number; qty: number; returnable: boolean }[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  address: Address;
  paymentMethod: string;
  status: "placed" | "packed" | "shipped" | "out_for_delivery" | "delivered" | "cancelled";
  statusLabel: string;
  timeline: TimelineEvent[];
  expectedDelivery: string;
  deliveredAt: string | null;
  cancel: { at: string; reason: string; by: string } | null;
  return: {
    status: "requested" | "approved" | "picked_up" | "refunded" | "rejected";
    statusLabel: string;
    reason: string;
    details: string;
    requestedAt: string;
    timeline: TimelineEvent[];
  } | null;
  refund: { status: "pending" | "completed"; amount: number; at: string | null } | null;
  canCancel: boolean;
  canReturn: boolean;
  returnBlockedReason: string | null;
  returnDeadline: string | null;
  customer?: { name: string; email: string } | null;
}

// ---------------------------------------------------------------- formatting

const rupees = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
export const money = (n: number) => rupees.format(n);

export const day = (iso: string | Date) =>
  new Date(iso).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

export const dateTime = (iso: string | Date) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export const percentOff = (p: { price: number; mrp: number }) =>
  p.mrp > p.price ? Math.round(((p.mrp - p.price) / p.mrp) * 100) : 0;
