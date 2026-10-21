import { randomInt } from "node:crypto";

import { Types } from "mongoose";

import { HttpError, notFound } from "./errors";
import { OrderModel, ProductModel, UserModel, type OrderDoc, type OrderStatus, type ReturnStatus } from "./models";
import {
  RETURN_LABEL,
  STATUS_LABEL,
  canCancel,
  deliveryFee,
  nextReturnStatus,
  nextStatus,
  returnDeadline,
  returnEligibility,
} from "./policy";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // no I, L, O, U

/** BS- and eight characters people can read out over the phone without confusion. */
export function newOrderNumber(): string {
  let s = "BS-";
  for (let i = 0; i < 8; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

const DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------- what the client sees

export function toOrderView(o: OrderDoc, now = new Date()) {
  const check = returnEligibility(
    { status: o.status as OrderStatus, deliveredAt: o.deliveredAt, return: o.return, items: o.items },
    now,
  );
  return {
    number: o.number,
    placedAt: (o as unknown as { createdAt: Date }).createdAt,
    items: o.items.map((i) => ({
      slug: i.slug,
      name: i.name,
      emoji: i.emoji,
      hue: i.hue,
      price: i.price,
      qty: i.qty,
      returnable: i.returnable,
    })),
    subtotal: o.subtotal,
    deliveryFee: o.deliveryFee,
    total: o.total,
    address: o.address,
    paymentMethod: o.paymentMethod,
    status: o.status,
    statusLabel: STATUS_LABEL[o.status as OrderStatus],
    timeline: o.timeline.map((e) => ({ status: e.status, at: e.at, note: e.note })),
    expectedDelivery: o.expectedDelivery,
    deliveredAt: o.deliveredAt,
    cancel: o.cancel ? { at: o.cancel.at, reason: o.cancel.reason, by: o.cancel.by } : null,
    return: o.return
      ? {
          status: o.return.status,
          statusLabel: RETURN_LABEL[o.return.status as ReturnStatus],
          reason: o.return.reason,
          details: o.return.details,
          requestedAt: o.return.requestedAt,
          timeline: o.return.timeline.map((e) => ({ status: e.status, at: e.at, note: e.note })),
        }
      : null,
    refund: o.refund ? { status: o.refund.status, amount: o.refund.amount, at: o.refund.at } : null,
    canCancel: canCancel(o.status as OrderStatus),
    canReturn: check.ok,
    returnBlockedReason: check.ok ? null : check.reason,
    returnDeadline: o.deliveredAt ? returnDeadline(o.deliveredAt) : null,
  };
}

export type OrderView = ReturnType<typeof toOrderView>;

// ---------------------------------------------------------------- placing an order

export async function placeOrder(userId: string, now = new Date()): Promise<OrderDoc> {
  const user = await UserModel.findById(userId);
  if (!user) throw new HttpError(401, "SIGN_IN_REQUIRED", "Please sign in to continue.");
  if (!user.address) throw new HttpError(400, "ADDRESS_REQUIRED", "Please add a delivery address first.");
  if (user.cart.length === 0) throw new HttpError(400, "CART_EMPTY", "Your cart is empty.");

  const products = await ProductModel.find({ _id: { $in: user.cart.map((l) => l.productId) } });
  const byId = new Map(products.map((p) => [p._id.toString(), p]));

  const taken: { id: Types.ObjectId; qty: number }[] = [];
  const release = () =>
    Promise.all(taken.map((t) => ProductModel.updateOne({ _id: t.id }, { $inc: { stock: t.qty } })));

  try {
    for (const line of user.cart) {
      const p = byId.get(line.productId.toString());
      if (!p) throw new HttpError(409, "PRODUCT_GONE", "An item in your cart is no longer sold. Please remove it.");
      // take the stock only if it is still there: two buyers cannot get the last one
      const ok = await ProductModel.updateOne({ _id: p._id, stock: { $gte: line.qty } }, { $inc: { stock: -line.qty } });
      if (ok.modifiedCount !== 1) throw new HttpError(409, "OUT_OF_STOCK", `Sorry, "${p.name}" does not have enough stock.`);
      taken.push({ id: p._id, qty: line.qty });
    }

    const items = user.cart.map((line) => {
      const p = byId.get(line.productId.toString())!;
      return {
        productId: p._id,
        slug: p.slug,
        name: p.name,
        emoji: p.emoji,
        hue: p.hue,
        price: p.price,
        qty: line.qty,
        returnable: p.returnable,
      };
    });
    const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
    const fee = deliveryFee(subtotal);
    const days = Math.max(...user.cart.map((l) => byId.get(l.productId.toString())!.deliveryDays));

    let order: OrderDoc | null = null;
    for (let attempt = 0; attempt < 5 && !order; attempt++) {
      try {
        order = (await OrderModel.create({
          number: newOrderNumber(),
          userId: user._id,
          items,
          subtotal,
          deliveryFee: fee,
          total: subtotal + fee,
          address: user.address,
          status: "placed",
          timeline: [{ status: "placed", at: now, note: "" }],
          expectedDelivery: new Date(now.getTime() + days * DAY),
        })) as unknown as OrderDoc;
      } catch (e) {
        if (!(e && typeof e === "object" && "code" in e && (e as { code: number }).code === 11000)) throw e;
      }
    }
    if (!order) throw new Error("Could not allocate an order number");

    await UserModel.updateOne({ _id: user._id }, { $set: { cart: [] } });
    return order;
  } catch (e) {
    await release();
    throw e;
  }
}

// ---------------------------------------------------------------- customer actions

async function ownOrder(userId: string, number: string): Promise<OrderDoc> {
  const order = await OrderModel.findOne({ number, userId });
  if (!order) throw notFound("That order");
  return order as unknown as OrderDoc;
}

export async function cancelOrder(userId: string, number: string, reason: string, now = new Date()): Promise<OrderDoc> {
  // the status is part of the filter: a parcel that ships at the same moment cannot also be cancelled
  const updated = await OrderModel.findOneAndUpdate(
    { number, userId, status: { $in: ["placed", "packed"] } },
    {
      $set: { status: "cancelled", cancel: { at: now, reason, by: "customer" } },
      $push: { timeline: { status: "cancelled", at: now, note: reason } },
    },
    { returnDocument: "after" },
  );
  if (!updated) {
    const order = await ownOrder(userId, number);
    if (order.status === "cancelled") throw new HttpError(409, "ALREADY_CANCELLED", "This order is already cancelled.");
    throw new HttpError(409, "CANNOT_CANCEL", "This order has already shipped, so it cannot be cancelled. You can return it after delivery.");
  }
  await Promise.all(updated.items.map((i) => ProductModel.updateOne({ _id: i.productId }, { $inc: { stock: i.qty } })));
  return updated as unknown as OrderDoc;
}

export async function requestReturn(
  userId: string,
  number: string,
  reason: string,
  details: string,
  now = new Date(),
): Promise<OrderDoc> {
  const order = await ownOrder(userId, number);
  const check = returnEligibility(
    { status: order.status as OrderStatus, deliveredAt: order.deliveredAt, return: order.return, items: order.items },
    now,
  );
  if (!check.ok) throw new HttpError(409, "CANNOT_RETURN", check.reason);
  const updated = await OrderModel.findOneAndUpdate(
    { number, userId, status: "delivered", return: null },
    {
      $set: {
        return: {
          status: "requested",
          reason,
          details,
          requestedAt: now,
          timeline: [{ status: "requested", at: now, note: reason }],
        },
      },
    },
    { returnDocument: "after" },
  );
  if (!updated) throw new HttpError(409, "CANNOT_RETURN", "A return has already been requested for this order.");
  return updated as unknown as OrderDoc;
}

// ---------------------------------------------------------------- store team actions

export async function advanceOrder(number: string, now = new Date()): Promise<OrderDoc> {
  const order = await OrderModel.findOne({ number });
  if (!order) throw notFound("That order");
  const next = nextStatus(order.status as OrderStatus);
  if (!next) throw new HttpError(409, "NO_NEXT_STEP", "This order has no next step.");
  const set: Record<string, unknown> = { status: next };
  if (next === "delivered") set.deliveredAt = now;
  const updated = await OrderModel.findOneAndUpdate(
    { number, status: order.status },
    { $set: set, $push: { timeline: { status: next, at: now, note: "" } } },
    { returnDocument: "after" },
  );
  if (!updated) throw new HttpError(409, "CHANGED", "Someone else just updated this order. Please refresh.");
  return updated as unknown as OrderDoc;
}

export async function advanceReturn(number: string, now = new Date()): Promise<OrderDoc> {
  const order = await OrderModel.findOne({ number });
  if (!order?.return) throw notFound("That return");
  const current = order.return.status as ReturnStatus;
  const next = nextReturnStatus(current);
  if (!next) throw new HttpError(409, "NO_NEXT_STEP", "This return has no next step.");
  const set: Record<string, unknown> = { "return.status": next };
  if (next === "picked_up") set.refund = { status: "pending", amount: order.total, at: null };
  if (next === "refunded") set.refund = { status: "completed", amount: order.total, at: now };
  const updated = await OrderModel.findOneAndUpdate(
    { number, "return.status": current },
    { $set: set, $push: { "return.timeline": { status: next, at: now, note: "" } } },
    { returnDocument: "after" },
  );
  if (!updated) throw new HttpError(409, "CHANGED", "Someone else just updated this return. Please refresh.");
  return updated as unknown as OrderDoc;
}

export async function rejectReturn(number: string, note: string, now = new Date()): Promise<OrderDoc> {
  const updated = await OrderModel.findOneAndUpdate(
    { number, "return.status": "requested" },
    { $set: { "return.status": "rejected" }, $push: { "return.timeline": { status: "rejected", at: now, note } } },
    { returnDocument: "after" },
  );
  if (!updated) throw new HttpError(409, "CANNOT_REJECT", "Only a newly requested return can be declined.");
  return updated as unknown as OrderDoc;
}
