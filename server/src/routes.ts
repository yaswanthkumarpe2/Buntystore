import { Router, type Request } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";

import { dummyVerify, hashPassword, requireAdmin, requireUser, verifyPassword, type createSessions } from "./auth";
import { HttpError, notFound, parse } from "./errors";
import { CATEGORIES, CATEGORY_IDS, ORDER_STATUSES, OrderModel, ProductModel, UserModel, type OrderDoc } from "./models";
import {
  advanceOrder,
  advanceReturn,
  cancelOrder,
  placeOrder,
  rejectReturn,
  requestReturn,
  toOrderView,
} from "./orders";
import {
  CANCEL_REASONS,
  DELIVERY_FEE,
  FREE_DELIVERY_FROM,
  RETURN_REASONS,
  RETURN_WINDOW_DAYS,
  deliveryFee,
} from "./policy";
import { issueIdentityToken } from "./serviqo";

type Sessions = ReturnType<typeof createSessions>;

const email = z.string().trim().toLowerCase().email("Enter a valid email address").max(200);
const password = z.string().min(8, "Use at least 8 characters").max(200);
const address = z.object({
  name: z.string().trim().min(2, "Enter the full name").max(100),
  phone: z.string().trim().regex(/^[6-9]\d{9}$/, "Enter a 10-digit mobile number"),
  line1: z.string().trim().min(5, "Enter the house and street").max(200),
  city: z.string().trim().min(2, "Enter the city").max(80),
  state: z.string().trim().min(2, "Enter the state").max(80),
  pincode: z.string().trim().regex(/^\d{6}$/, "Enter a 6-digit pincode"),
});

const userId = (req: Request) => req.user!.id;

function toProductView(p: {
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
  stock: number;
  returnable: boolean;
  deliveryDays: number;
}) {
  return {
    slug: p.slug,
    name: p.name,
    category: p.category,
    price: p.price,
    mrp: p.mrp,
    emoji: p.emoji,
    hue: p.hue,
    description: p.description,
    highlights: p.highlights,
    rating: p.rating,
    ratingCount: p.ratingCount,
    inStock: p.stock > 0,
    lowStock: p.stock > 0 && p.stock <= 5,
    returnable: p.returnable,
    deliveryDays: p.deliveryDays,
  };
}

export function apiRouter(sessions: Sessions, opts: { authLimit: number; identitySecret?: string }): Router {
  const r = Router();

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: opts.authLimit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res) =>
      res.status(429).json({ error: { code: "TOO_MANY_TRIES", message: "Too many tries. Please wait a few minutes." } }),
  });

  // ---------------------------------------------------------------- store info

  r.get("/store", (_req, res) => {
    res.json({
      categories: CATEGORIES,
      policy: {
        returnWindowDays: RETURN_WINDOW_DAYS,
        freeDeliveryFrom: FREE_DELIVERY_FROM,
        deliveryFee: DELIVERY_FEE,
        cancelReasons: CANCEL_REASONS,
        returnReasons: RETURN_REASONS,
      },
    });
  });

  // ---------------------------------------------------------------- account

  r.post("/auth/signup", authLimiter, async (req, res) => {
    const body = parse(
      z.object({ name: z.string().trim().min(2, "Enter your name").max(100), email, password }),
      req.body,
    );
    const exists = await UserModel.exists({ email: body.email });
    if (exists) throw new HttpError(409, "EMAIL_TAKEN", "An account with this email already exists. Please sign in.");
    const user = await UserModel.create({ name: body.name, email: body.email, passwordHash: await hashPassword(body.password) });
    await sessions.issue(res, { id: user._id.toString(), role: "customer" });
    res.status(201).json({ user: { id: user._id.toString(), name: user.name, email: user.email, role: user.role, address: null } });
  });

  r.post("/auth/login", authLimiter, async (req, res) => {
    const body = parse(z.object({ email, password: z.string().min(1, "Enter your password").max(200) }), req.body);
    const user = await UserModel.findOne({ email: body.email });
    const ok = user ? await verifyPassword(user.passwordHash, body.password) : await dummyVerify(body.password);
    if (!user || !ok) throw new HttpError(401, "WRONG_DETAILS", "Email or password is not correct.");
    await sessions.issue(res, { id: user._id.toString(), role: user.role as "customer" | "admin" });
    res.json({ user: { id: user._id.toString(), name: user.name, email: user.email, role: user.role, address: user.address } });
  });

  r.post("/auth/logout", (_req, res) => {
    sessions.clear(res);
    res.json({ ok: true });
  });

  r.get("/me", requireUser, async (req, res) => {
    const user = await UserModel.findById(userId(req));
    if (!user) {
      throw new HttpError(401, "SIGN_IN_REQUIRED", "Please sign in to continue.");
    }
    res.json({ user: { id: user._id.toString(), name: user.name, email: user.email, role: user.role, address: user.address } });
  });

  /** The signed-in customer's short-lived pass for the Serviqo chat (Serviqo ADR-060). */
  r.get("/me/serviqo-identity", requireUser, async (req, res) => {
    if (!opts.identitySecret) throw notFound("That address");
    const user = await UserModel.findById(userId(req), { name: 1, email: 1 }).lean();
    if (!user) throw new HttpError(401, "SIGN_IN_REQUIRED", "Please sign in to continue.");
    const pass = await issueIdentityToken(opts.identitySecret, { id: userId(req), name: user.name, email: user.email });
    res.set("Cache-Control", "no-store").json(pass);
  });

  r.put("/me/address", requireUser, async (req, res) => {
    const body = parse(address, req.body);
    await UserModel.updateOne({ _id: userId(req) }, { $set: { address: body } });
    res.json({ address: body });
  });

  // ---------------------------------------------------------------- products

  r.get("/products", async (req, res) => {
    const q = parse(
      z.object({
        category: z.enum(CATEGORY_IDS).optional(),
        q: z.string().trim().max(80).optional(),
        sort: z.enum(["popular", "price_low", "price_high", "rating"]).default("popular"),
      }),
      req.query,
    );
    const filter: Record<string, unknown> = {};
    if (q.category) filter.category = q.category;
    if (q.q) {
      const safe = q.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [{ name: { $regex: safe, $options: "i" } }, { description: { $regex: safe, $options: "i" } }];
    }
    const sort: Record<string, 1 | -1> =
      q.sort === "price_low" ? { price: 1 } : q.sort === "price_high" ? { price: -1 } : q.sort === "rating" ? { rating: -1 } : { ratingCount: -1 };
    const products = await ProductModel.find(filter).sort(sort).limit(100).lean();
    res.json({ products: products.map(toProductView) });
  });

  r.get("/products/:slug", async (req, res) => {
    const p = await ProductModel.findOne({ slug: String(req.params.slug) }).lean();
    if (!p) throw notFound("That product");
    const related = await ProductModel.find({ category: p.category, _id: { $ne: p._id } }).sort({ ratingCount: -1 }).limit(4).lean();
    res.json({ product: toProductView(p), related: related.map(toProductView) });
  });

  // ---------------------------------------------------------------- cart

  async function cartView(id: string) {
    const user = await UserModel.findById(id);
    if (!user) throw new HttpError(401, "SIGN_IN_REQUIRED", "Please sign in to continue.");
    const products = await ProductModel.find({ _id: { $in: user.cart.map((l) => l.productId) } }).lean();
    const byId = new Map(products.map((p) => [p._id.toString(), p]));
    const lines = user.cart
      .map((l) => {
        const p = byId.get(l.productId.toString());
        return p ? { product: toProductView(p), qty: l.qty, lineTotal: p.price * l.qty } : null;
      })
      .filter((l): l is NonNullable<typeof l> => l !== null);
    const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
    const fee = lines.length ? deliveryFee(subtotal) : 0;
    return { lines, count: lines.reduce((s, l) => s + l.qty, 0), subtotal, deliveryFee: fee, total: subtotal + fee };
  }

  r.get("/cart", requireUser, async (req, res) => {
    res.json({ cart: await cartView(userId(req)) });
  });

  /** Sets one product's quantity in the cart; 0 removes it. */
  r.put("/cart/:slug", requireUser, async (req, res) => {
    const { qty } = parse(z.object({ qty: z.number().int().min(0).max(10) }), req.body);
    const p = await ProductModel.findOne({ slug: String(req.params.slug) });
    if (!p) throw notFound("That product");
    if (qty > 0 && p.stock < qty) throw new HttpError(409, "OUT_OF_STOCK", `Only ${p.stock} left in stock.`);
    const user = await UserModel.findById(userId(req));
    if (!user) throw new HttpError(401, "SIGN_IN_REQUIRED", "Please sign in to continue.");
    const others = user.cart.filter((l) => !l.productId.equals(p._id));
    const cart = qty > 0 ? [...others, { productId: p._id, qty }] : others;
    if (cart.length > 30) throw new HttpError(400, "CART_FULL", "Your cart is full.");
    await UserModel.updateOne({ _id: user._id }, { $set: { cart } });
    res.json({ cart: await cartView(userId(req)) });
  });

  // ---------------------------------------------------------------- orders (the customer's own only)

  r.post("/orders", requireUser, async (req, res) => {
    const order = await placeOrder(userId(req));
    res.status(201).json({ order: toOrderView(order) });
  });

  r.get("/orders", requireUser, async (req, res) => {
    const orders = await OrderModel.find({ userId: userId(req) }).sort({ createdAt: -1 }).limit(100);
    res.json({ orders: orders.map((o) => toOrderView(o as unknown as OrderDoc)) });
  });

  r.get("/orders/:number", requireUser, async (req, res) => {
    const order = await OrderModel.findOne({ number: String(req.params.number), userId: userId(req) });
    if (!order) throw notFound("That order");
    res.json({ order: toOrderView(order as unknown as OrderDoc) });
  });

  r.post("/orders/:number/cancel", requireUser, async (req, res) => {
    const { reason } = parse(z.object({ reason: z.enum(CANCEL_REASONS) }), req.body);
    const order = await cancelOrder(userId(req), String(req.params.number), reason);
    res.json({ order: toOrderView(order) });
  });

  r.post("/orders/:number/return", requireUser, async (req, res) => {
    const body = parse(
      z.object({ reason: z.enum(RETURN_REASONS), details: z.string().trim().max(500).default("") }),
      req.body,
    );
    const order = await requestReturn(userId(req), String(req.params.number), body.reason, body.details);
    res.json({ order: toOrderView(order) });
  });

  // ---------------------------------------------------------------- store team

  r.get("/admin/orders", requireAdmin, async (req, res) => {
    const q = parse(
      z.object({
        status: z.enum([...ORDER_STATUSES, "returns"]).optional(),
        q: z.string().trim().max(80).optional(),
      }),
      req.query,
    );
    const filter: Record<string, unknown> = {};
    if (q.status === "returns") filter.return = { $ne: null };
    else if (q.status) filter.status = q.status;
    if (q.q) filter.number = { $regex: `^${q.q.toUpperCase().replace(/[^A-Z0-9-]/g, "")}` };
    const orders = await OrderModel.find(filter).sort({ createdAt: -1 }).limit(200).populate("userId", "name email").lean();
    res.json({
      orders: orders.map((o) => {
        const who = o.userId as unknown as { name?: string; email?: string } | null;
        return {
          ...toOrderView(o as unknown as OrderDoc),
          customer: who?.email ? { name: who.name ?? "", email: who.email } : null,
        };
      }),
    });
  });

  r.post("/admin/orders/:number/advance", requireAdmin, async (req, res) => {
    res.json({ order: toOrderView(await advanceOrder(String(req.params.number))) });
  });

  r.post("/admin/orders/:number/return/advance", requireAdmin, async (req, res) => {
    res.json({ order: toOrderView(await advanceReturn(String(req.params.number))) });
  });

  r.post("/admin/orders/:number/return/reject", requireAdmin, async (req, res) => {
    const { note } = parse(z.object({ note: z.string().trim().min(3, "Say why").max(300) }), req.body);
    res.json({ order: toOrderView(await rejectReturn(String(req.params.number), note)) });
  });

  r.use((_req, _res, next) => next(notFound("That address")));
  return r;
}
