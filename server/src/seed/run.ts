/**
 * `npm run seed`: the catalogue, the store admin and sample customers with orders in every state.
 * Passwords come from the environment (SEED_ADMIN_PASSWORD, SEED_DEMO_PASSWORD), never from the repo.
 * Safe to run twice: existing users and their orders are left alone.
 */
import mongoose from "mongoose";

import { hashPassword } from "../auth";
import { loadEnv } from "../env";
import { OrderModel, ProductModel, UserModel, type OrderStatus } from "../models";
import { newOrderNumber } from "../orders";
import { deliveryFee } from "../policy";
import { ensureCatalog } from "./catalogSeed";

const DAY = 24 * 60 * 60 * 1000;

const CUSTOMERS = [
  { name: "Priya Sharma", email: "priya.sharma@example.com", city: "Hyderabad", state: "Telangana", pincode: "500081", phone: "9876543210" },
  { name: "Rahul Verma", email: "rahul.verma@example.com", city: "Pune", state: "Maharashtra", pincode: "411001", phone: "9123456780" },
  { name: "Ananya Reddy", email: "ananya.reddy@example.com", city: "Bengaluru", state: "Karnataka", pincode: "560034", phone: "9988776655" },
  { name: "Arjun Mehta", email: "arjun.mehta@example.com", city: "Jalandhar", state: "Punjab", pincode: "144411", phone: "9012345678" },
];

/** [customer index, product slugs, how many days ago placed, how far it got, extra] */
type Plan = [number, string[], number, OrderStatus, ("return_requested" | "refunded" | null)?];
const PLANS: Plan[] = [
  [0, ["nova-5g-smartphone-128-gb", "pulse-wireless-earbuds"], 6, "delivered"],
  [0, ["floral-summer-dress"], 1, "shipped"],
  [0, ["basmati-rice-5-kg", "toor-dal-1-kg", "assam-tea-500-g"], 0, "placed"],
  [1, ["swift-laptop-14-8-gb-512-gb"], 3, "out_for_delivery"],
  [1, ["runner-sports-shoes"], 9, "delivered", "return_requested"],
  [1, ["electric-kettle-1-5-l"], 2, "cancelled"],
  [2, ["vitamin-c-face-serum", "daily-sunscreen-spf-50"], 12, "delivered", "refunded"],
  [2, ["the-little-book-of-habits", "learn-python-in-30-days"], 2, "packed"],
  [3, ["everyday-backpack"], 4, "delivered"],
  [3, ["orbit-smartwatch"], 1, "placed"],
];

async function main() {
  const env = loadEnv();
  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  const demoPassword = process.env.SEED_DEMO_PASSWORD;
  if (!adminEmail || !adminPassword || adminPassword.length < 8 || !demoPassword || demoPassword.length < 8) {
    throw new Error("Set SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD and SEED_DEMO_PASSWORD (8+ characters) to seed.");
  }

  await mongoose.connect(env.MONGODB_URI);
  console.log(`catalogue: ${await ensureCatalog()} products added`);

  if (!(await UserModel.exists({ email: adminEmail }))) {
    await UserModel.create({ name: "Bunty Store Team", email: adminEmail, passwordHash: await hashPassword(adminPassword), role: "admin" });
    console.log(`admin: ${adminEmail} created`);
  }

  const demoHash = await hashPassword(demoPassword);
  const users = [];
  for (const c of CUSTOMERS) {
    let user = await UserModel.findOne({ email: c.email });
    const isNew = !user;
    user ??= await UserModel.create({
      name: c.name,
      email: c.email,
      passwordHash: demoHash,
      address: { name: c.name, phone: c.phone, line1: "Flat 12, Green Park Apartments", city: c.city, state: c.state, pincode: c.pincode },
    });
    users.push({ user, isNew });
  }

  const now = Date.now();
  let made = 0;
  for (const [ci, slugs, daysAgo, reached, extra] of PLANS) {
    const { user, isNew } = users[ci]!;
    if (!isNew) continue; // existing sample customers keep their orders
    const products = await ProductModel.find({ slug: { $in: slugs } });
    if (products.length !== slugs.length) throw new Error(`Unknown product in plan: ${slugs.join(", ")}`);
    const items = products.map((p) => ({
      productId: p._id, slug: p.slug, name: p.name, emoji: p.emoji, hue: p.hue, price: p.price, qty: 1, returnable: p.returnable,
    }));
    const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
    const fee = deliveryFee(subtotal);
    const placedAt = new Date(now - daysAgo * DAY - 3 * 60 * 60 * 1000);
    const flow: OrderStatus[] = ["placed", "packed", "shipped", "out_for_delivery", "delivered"];
    const timeline =
      reached === "cancelled"
        ? [{ status: "placed", at: placedAt, note: "" }, { status: "cancelled", at: new Date(placedAt.getTime() + 2 * 60 * 60 * 1000), note: "Ordered by mistake" }]
        : flow.slice(0, flow.indexOf(reached) + 1).map((s, i) => ({
            status: s,
            at: new Date(placedAt.getTime() + i * Math.max(1, daysAgo) * DAY * 0.22),
            note: "",
          }));
    const days = Math.max(...products.map((p) => p.deliveryDays));
    const deliveredAt = reached === "delivered" ? timeline[timeline.length - 1]!.at : null;
    const order: Record<string, unknown> = {
      number: newOrderNumber(),
      userId: user._id,
      items,
      subtotal,
      deliveryFee: fee,
      total: subtotal + fee,
      address: user.address,
      status: reached,
      timeline,
      expectedDelivery: new Date(placedAt.getTime() + days * DAY),
      deliveredAt,
      createdAt: placedAt,
    };
    if (reached === "cancelled") order.cancel = { at: timeline[1]!.at, reason: "Ordered by mistake", by: "customer" };
    if (extra === "return_requested" && deliveredAt) {
      const at = new Date(deliveredAt.getTime() + DAY);
      order.return = { status: "requested", reason: "Size or fit is not right", details: "Too tight at the front.", requestedAt: at, timeline: [{ status: "requested", at, note: "Size or fit is not right" }] };
    }
    if (extra === "refunded" && deliveredAt) {
      const at = (h: number) => new Date(deliveredAt.getTime() + h * 60 * 60 * 1000);
      order.return = {
        status: "refunded", reason: "Quality is not good", details: "", requestedAt: at(20),
        timeline: [
          { status: "requested", at: at(20), note: "Quality is not good" },
          { status: "approved", at: at(30), note: "" },
          { status: "picked_up", at: at(60), note: "" },
          { status: "refunded", at: at(90), note: "" },
        ],
      };
      order.refund = { status: "completed", amount: subtotal + fee, at: at(90) };
    }
    const created = await OrderModel.create(order);
    // timestamps would stamp "now"; a sample order keeps the day it was placed
    await OrderModel.collection.updateOne({ _id: created._id }, { $set: { createdAt: placedAt } });
    made++;
  }
  console.log(`sample orders: ${made} created`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await mongoose.disconnect();
  process.exit(1);
});
