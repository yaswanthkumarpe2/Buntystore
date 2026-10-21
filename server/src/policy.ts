import type { OrderStatus, ReturnStatus } from "./models";

/**
 * The store's rules, in one place. The order pages, the API and (later) the
 * Serviqo assistant all read them from here, so they can never disagree.
 */

export const RETURN_WINDOW_DAYS = 7;
export const FREE_DELIVERY_FROM = 499; // rupees
export const DELIVERY_FEE = 40; // rupees

/** The order moves through these in turn; "cancelled" is outside the line. */
export const ORDER_FLOW: OrderStatus[] = ["placed", "packed", "shipped", "out_for_delivery", "delivered"];

export const STATUS_LABEL: Record<OrderStatus, string> = {
  placed: "Order placed",
  packed: "Packed",
  shipped: "Shipped",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export const RETURN_FLOW: ReturnStatus[] = ["requested", "approved", "picked_up", "refunded"];

export const RETURN_LABEL: Record<ReturnStatus, string> = {
  requested: "Return requested",
  approved: "Return approved",
  picked_up: "Picked up",
  refunded: "Refunded",
  rejected: "Return not accepted",
};

export const CANCEL_REASONS = [
  "Ordered by mistake",
  "Found a better price",
  "Delivery is too late",
  "Want to change the item",
  "Other",
] as const;

export const RETURN_REASONS = [
  "Item is damaged",
  "Wrong item received",
  "Item does not match the description",
  "Size or fit is not right",
  "Quality is not good",
  "No longer needed",
] as const;

/** Cancelling is possible until the parcel leaves the warehouse. */
export function canCancel(status: OrderStatus): boolean {
  return status === "placed" || status === "packed";
}

export function nextStatus(status: OrderStatus): OrderStatus | null {
  const i = ORDER_FLOW.indexOf(status);
  return i >= 0 && i < ORDER_FLOW.length - 1 ? (ORDER_FLOW[i + 1] ?? null) : null;
}

export function returnDeadline(deliveredAt: Date): Date {
  return new Date(deliveredAt.getTime() + RETURN_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

export type ReturnCheck = { ok: true } | { ok: false; reason: string };

/** Whether this order can be returned now, and in plain words why not. */
export function returnEligibility(
  order: { status: OrderStatus; deliveredAt?: Date | null; return?: unknown; items: { returnable: boolean }[] },
  now = new Date(),
): ReturnCheck {
  if (order.return) return { ok: false, reason: "A return has already been requested for this order." };
  if (order.status !== "delivered" || !order.deliveredAt)
    return { ok: false, reason: "You can return an order after it is delivered." };
  if (now > returnDeadline(order.deliveredAt))
    return { ok: false, reason: `The ${RETURN_WINDOW_DAYS}-day return window has closed.` };
  if (order.items.some((i) => !i.returnable))
    return { ok: false, reason: "This order has an item that cannot be returned (grocery items)." };
  return { ok: true };
}

export function nextReturnStatus(status: ReturnStatus): ReturnStatus | null {
  const i = RETURN_FLOW.indexOf(status);
  return i >= 0 && i < RETURN_FLOW.length - 1 ? (RETURN_FLOW[i + 1] ?? null) : null;
}

export function deliveryFee(subtotal: number): number {
  return subtotal >= FREE_DELIVERY_FROM ? 0 : DELIVERY_FEE;
}
