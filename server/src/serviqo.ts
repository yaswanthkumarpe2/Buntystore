import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import express, { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { SignJWT } from "jose";
import { z } from "zod";

import type { OrderNotifier } from "./emails";
import { HttpError, notFound, parse } from "./errors";
import { ConnectorActionModel, ConnectorNonceModel, OrderModel, UserModel, type OrderDoc, type OrderStatus } from "./models";
import { cancelOrder, requestReturn, toOrderView } from "./orders";
import {
  CANCEL_REASONS,
  DELIVERY_FEE,
  FREE_DELIVERY_FROM,
  RETURN_REASONS,
  RETURN_WINDOW_DAYS,
  cancelBlockedReason,
} from "./policy";

/**
 * The private door Serviqo's AI uses to answer a signed-in customer about
 * their own orders (Serviqo ADR-060). Nothing here is reachable without a
 * request signed with SERVIQO_CONNECTOR_SECRET, and nothing it returns
 * includes an address, a phone number or anything the customer typed.
 *
 * The rules are not repeated here: cancelling and returning call the same
 * functions the website does, so Bunty's policy decides every time.
 */

// ---------------------------------------------------------------- signing

/** How far a request's timestamp may be from this server's clock. */
export const SIGNATURE_WINDOW_SECONDS = 300;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * The exact text both sides sign: a version, the method, the path with its
 * query string, the timestamp, the nonce and the SHA-256 of the raw body
 * (of nothing, for a GET), one per line.
 */
export function signingText(method: string, pathWithQuery: string, timestamp: string, nonce: string, body: Buffer): string {
  const bodyHash = createHash("sha256").update(body).digest("hex");
  return ["v1", method.toUpperCase(), pathWithQuery, timestamp, nonce, bodyHash].join("\n");
}

export function signRequest(
  secret: string,
  method: string,
  pathWithQuery: string,
  timestamp: string,
  nonce: string,
  body: Buffer,
): string {
  return "v1=" + createHmac("sha256", secret).update(signingText(method, pathWithQuery, timestamp, nonce, body)).digest("hex");
}

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const refuse = (code: string, message: string) => new HttpError(401, code, message);

function requireSignature(secret: string) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const timestamp = req.get("X-Serviqo-Timestamp") ?? "";
    const nonce = req.get("X-Serviqo-Nonce") ?? "";
    const signature = req.get("X-Serviqo-Signature") ?? "";
    if (!timestamp || !nonce || !signature) {
      return next(refuse("SIGNATURE_REQUIRED", "This request must be signed."));
    }

    const seconds = /^\d{1,12}$/.test(timestamp) ? Number(timestamp) : NaN;
    if (!Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > SIGNATURE_WINDOW_SECONDS) {
      return next(refuse("STALE_REQUEST", "This request's timestamp is too old or too far ahead."));
    }
    if (!NONCE_PATTERN.test(nonce)) return next(refuse("BAD_SIGNATURE", "This request's signature is not valid."));

    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const expected = signRequest(secret, req.method, req.originalUrl, timestamp, nonce, body);
    if (!sameText(signature, expected)) return next(refuse("BAD_SIGNATURE", "This request's signature is not valid."));

    // Only a correctly signed request may use up a nonce, so nobody can burn
    // nonces they did not sign. The unique index makes a replay fail here.
    try {
      await ConnectorNonceModel.create({
        nonce,
        expiresAt: new Date((seconds + 2 * SIGNATURE_WINDOW_SECONDS) * 1000),
      });
    } catch (e) {
      if (e && typeof e === "object" && "code" in e && (e as { code: number }).code === 11000) {
        return next(refuse("REPLAYED_REQUEST", "This signed request was already used."));
      }
      return next(e);
    }

    // The body was kept raw for the signature; now it can be read.
    if (body.length === 0) {
      req.body = {};
    } else {
      try {
        req.body = JSON.parse(body.toString("utf8"));
      } catch {
        return next(new HttpError(400, "INVALID_JSON", "The request could not be read."));
      }
    }
    next();
  };
}

// ---------------------------------------------------------------- what Serviqo may see

const OPEN_STATUSES: OrderStatus[] = ["placed", "packed", "shipped", "out_for_delivery"];

/** One order, limited to what the assistant needs: no address, no phone, no free text the customer typed. */
export function toConnectorOrderView(o: OrderDoc, now = new Date()) {
  const v = toOrderView(o, now);
  return {
    number: v.number,
    placedAt: v.placedAt,
    status: v.status,
    statusLabel: v.statusLabel,
    items: v.items.map((i) => ({ name: i.name, qty: i.qty, price: i.price, returnable: i.returnable, emoji: i.emoji })),
    subtotal: v.subtotal,
    deliveryFee: v.deliveryFee,
    total: v.total,
    paymentMethod: "Pay on delivery",
    expectedDelivery: v.expectedDelivery,
    deliveredAt: v.deliveredAt,
    timeline: v.timeline.map((e) => ({ status: e.status, at: e.at })),
    cancel: v.cancel ? { at: v.cancel.at, reason: v.cancel.reason, by: v.cancel.by } : null,
    return: v.return
      ? {
          status: v.return.status,
          statusLabel: v.return.statusLabel,
          reason: v.return.reason,
          requestedAt: v.return.requestedAt,
          timeline: v.return.timeline.map((e) => ({ status: e.status, at: e.at })),
        }
      : null,
    refund: v.refund,
    canCancel: v.canCancel,
    cancelBlockedReason: cancelBlockedReason(v.status as OrderStatus),
    canReturn: v.canReturn,
    returnBlockedReason: v.returnBlockedReason,
    returnDeadline: v.returnDeadline,
  };
}

const customerId = z.string().regex(/^[a-f0-9]{24}$/);

async function customerOf(req: Request) {
  const id = customerId.safeParse(req.params.customerId);
  if (!id.success) throw notFound("That customer");
  const user = await UserModel.findById(id.data, { name: 1, email: 1, createdAt: 1 }).lean();
  if (!user) throw notFound("That customer");
  return { id: id.data, user };
}

async function ownOrder(id: string, number: string) {
  const order = await OrderModel.findOne({ number, userId: id });
  if (!order) throw notFound("That order");
  return order as unknown as OrderDoc;
}

// ---------------------------------------------------------------- doing things exactly once

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,100}$/;
const IDEMPOTENCY_HOURS = 24;

type Outcome = { status: number; body: unknown };

/**
 * Runs an action at most once per Idempotency-Key. The key is claimed before
 * the action runs, so two copies of the same request racing each other
 * cannot both act; the outcome, refusals included, is kept so a retry gets
 * the first answer. A key reused for a different action is refused.
 */
async function once(
  key: string,
  action: "cancel" | "return",
  who: string,
  orderNumber: string,
  run: () => Promise<unknown>,
): Promise<Outcome> {
  const matches = (doc: { action: string; customerId: string; orderNumber: string }) =>
    doc.action === action && doc.customerId === who && doc.orderNumber === orderNumber;

  const replay = async (): Promise<Outcome> => {
    const doc = await ConnectorActionModel.findOne({ key }).lean();
    if (!doc) throw new HttpError(409, "IN_PROGRESS", "This action is being retried. Please try again.");
    if (!matches(doc)) {
      throw new HttpError(422, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used for a different action.");
    }
    if (doc.state !== "done") throw new HttpError(409, "IN_PROGRESS", "This action is still running. Please try again.");
    return { status: doc.responseStatus ?? 200, body: doc.responseBody };
  };

  try {
    await ConnectorActionModel.create({
      key,
      action,
      customerId: who,
      orderNumber,
      state: "running",
      expiresAt: new Date(Date.now() + IDEMPOTENCY_HOURS * 60 * 60 * 1000),
    });
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && (e as { code: number }).code === 11000) return replay();
    throw e;
  }

  let outcome: Outcome;
  try {
    outcome = { status: 200, body: await run() };
  } catch (e) {
    if (!(e instanceof HttpError)) {
      // an unexpected failure: free the key so a retry can try again
      await ConnectorActionModel.deleteOne({ key, state: "running" });
      throw e;
    }
    outcome = { status: e.status, body: { error: { code: e.code, message: e.message } } };
  }
  await ConnectorActionModel.updateOne(
    { key },
    { $set: { state: "done", responseStatus: outcome.status, responseBody: outcome.body } },
  );
  return outcome;
}

function idempotencyKey(req: Request): string {
  const key = req.get("Idempotency-Key") ?? "";
  if (!IDEMPOTENCY_KEY.test(key)) {
    throw new HttpError(400, "IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key header (8 to 100 letters, digits, - or _).");
  }
  return key;
}

// ---------------------------------------------------------------- the routes

export function serviqoRouter(opts: { connectorSecret?: string; notify?: OrderNotifier }): Router {
  const notify = opts.notify ?? (() => undefined);
  const r = Router();

  if (!opts.connectorSecret) {
    r.use((_req, _res, next) => next(notFound("That address")));
    return r;
  }

  r.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: (_req, res) =>
        res.status(429).json({ error: { code: "TOO_MANY_REQUESTS", message: "Too many requests. Please slow down." } }),
    }),
  );
  // raw, not JSON: the signature covers the exact bytes that were sent
  r.use(express.raw({ type: () => true, limit: "20kb" }));
  r.use(requireSignature(opts.connectorSecret));

  r.get("/policy", (_req, res) => {
    res.json({
      store: "Bunty Store",
      policy: {
        returnWindowDays: RETURN_WINDOW_DAYS,
        freeDeliveryFrom: FREE_DELIVERY_FROM,
        deliveryFee: DELIVERY_FEE,
        cancelReasons: CANCEL_REASONS,
        returnReasons: RETURN_REASONS,
        rules: [
          "An order can be cancelled until it ships, while it is placed or packed.",
          `A delivered order can be returned within ${RETURN_WINDOW_DAYS} days of delivery, except orders with grocery items.`,
          "A return covers the whole order. The refund is the order total and is completed after the parcel is picked up.",
          `Delivery is free from ₹${FREE_DELIVERY_FROM}; below that it costs ₹${DELIVERY_FEE}.`,
          "Payment is on delivery only. Bunty Store is opening soon: orders are not shipped yet, and nothing is charged.",
        ],
      },
    });
  });

  r.get("/customers/:customerId", async (req, res) => {
    const { id, user } = await customerOf(req);
    const [orderCount, openOrderCount, openReturnCount] = await Promise.all([
      OrderModel.countDocuments({ userId: id }),
      OrderModel.countDocuments({ userId: id, status: { $in: OPEN_STATUSES } }),
      OrderModel.countDocuments({ userId: id, "return.status": { $in: ["requested", "approved", "picked_up"] } }),
    ]);
    res.json({
      customer: {
        id,
        name: user.name,
        email: user.email,
        memberSince: (user as unknown as { createdAt: Date }).createdAt,
        orderCount,
        openOrderCount,
        openReturnCount,
      },
    });
  });

  r.get("/customers/:customerId/orders", async (req, res) => {
    const { id } = await customerOf(req);
    const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(20).default(5) }), req.query);
    const orders = await OrderModel.find({ userId: id }).sort({ createdAt: -1 }).limit(limit);
    res.json({ orders: orders.map((o) => toConnectorOrderView(o as unknown as OrderDoc)) });
  });

  r.get("/customers/:customerId/orders/:number", async (req, res) => {
    const { id } = await customerOf(req);
    const order = await ownOrder(id, String(req.params.number));
    res.json({ order: toConnectorOrderView(order) });
  });

  r.post("/customers/:customerId/orders/:number/cancel", async (req, res) => {
    const key = idempotencyKey(req);
    const { id } = await customerOf(req);
    const number = String(req.params.number);
    const { reason } = parse(z.object({ reason: z.enum(CANCEL_REASONS) }), req.body);
    const outcome = await once(key, "cancel", id, number, async () => {
      const order = await cancelOrder(id, number, reason);
      notify(order, "cancelled");
      return { order: toConnectorOrderView(order) };
    });
    res.status(outcome.status).json(outcome.body);
  });

  r.post("/customers/:customerId/orders/:number/return", async (req, res) => {
    const key = idempotencyKey(req);
    const { id } = await customerOf(req);
    const number = String(req.params.number);
    // no free-text details from the assistant: the customer can add those on the order page
    const { reason } = parse(z.object({ reason: z.enum(RETURN_REASONS) }), req.body);
    const outcome = await once(key, "return", id, number, async () => {
      const order = await requestReturn(id, number, reason, "");
      notify(order, "return_requested");
      return { order: toConnectorOrderView(order) };
    });
    res.status(outcome.status).json(outcome.body);
  });

  r.use((_req, _res, next) => next(notFound("That address")));
  return r;
}

// ---------------------------------------------------------------- who is chatting

export const IDENTITY_MINUTES = 10;

/**
 * A short-lived pass that tells Serviqo which Bunty customer is in the chat.
 * The widget hands it to Serviqo, which checks it with the same secret;
 * without it the assistant sees no account at all.
 */
export async function issueIdentityToken(
  secret: string,
  user: { id: string; name: string; email: string },
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const expiresAt = new Date((issuedAt + IDENTITY_MINUTES * 60) * 1000);
  const token = await new SignJWT({ email: user.email, name: user.name })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("bunty-store")
    .setAudience("serviqo")
    .setSubject(user.id)
    .setIssuedAt(issuedAt)
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .setJti(randomUUID())
    .sign(new TextEncoder().encode(secret));
  return { token, expiresAt };
}

// ---------------------------------------------------------------- the chat on every page

/** The Serviqo chat: where widget.js comes from (a bare origin) and Bunty's widget key. */
export interface ServiqoChat {
  origin: string;
  widgetKey: string;
}
