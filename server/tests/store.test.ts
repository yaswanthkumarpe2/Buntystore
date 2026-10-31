import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { hashPassword } from "../src/auth";
import { OrderModel, ProductModel, UserModel } from "../src/models";
import { ensureCatalog } from "../src/seed/catalogSeed";

import { signedInCustomer } from "./helpers";

let mongo: MongoMemoryServer;
const app = createApp({ sessionSecret: "test-secret-test-secret-test-secret-123", production: false, authLimit: 1000 });

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri("bunty-test"));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await mongoose.connection.db!.dropDatabase();
  await ProductModel.syncIndexes();
  await UserModel.syncIndexes();
  await OrderModel.syncIndexes();
  await ensureCatalog();
});

const ADDRESS = { name: "Priya Sharma", phone: "9876543210", line1: "Flat 12, Green Park", city: "Hyderabad", state: "Telangana", pincode: "500081" };

async function customer(email = "priya@example.com") {
  return (await signedInCustomer(app, email)).agent;
}

async function admin() {
  await UserModel.create({ name: "Team", email: "team@example.com", passwordHash: await hashPassword("team-password"), role: "admin" });
  const agent = request.agent(app);
  expect((await agent.post("/api/auth/login").send({ email: "team@example.com", password: "team-password" })).status).toBe(200);
  return agent;
}

async function orderOf(agent: ReturnType<typeof request.agent>, slug: string, qty = 1) {
  await agent.put("/api/me/address").send(ADDRESS).expect(200);
  await agent.put(`/api/cart/${slug}`).send({ qty }).expect(200);
  const res = await agent.post("/api/orders");
  expect(res.status).toBe(201);
  return res.body.order as { number: string; status: string; total: number; canCancel: boolean };
}

describe("accounts", () => {
  it("signs in, stays signed in with a cookie, and signs out", async () => {
    const agent = await customer();
    const me = await agent.get("/api/me");
    expect(me.body.user.email).toBe("priya@example.com");
    expect(JSON.stringify(me.body)).not.toContain("passwordHash");
    await agent.post("/api/auth/logout").expect(200);
    expect((await agent.get("/api/me")).status).toBe(401);
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    await customer();
    const wrong = await request(app).post("/api/auth/login").send({ email: "priya@example.com", password: "nope-nope" });
    const unknown = await request(app).post("/api/auth/login").send({ email: "nobody@example.com", password: "nope-nope" });
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
  });

  it("explains a bad input in plain words", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "not-an-email", password: "x" });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/email/i);
  });
});

describe("products", () => {
  it("lists 60 products in 6 categories, and filters and searches them", async () => {
    const all = await request(app).get("/api/products");
    expect(all.body.products).toHaveLength(60);
    const books = await request(app).get("/api/products?category=books");
    expect(books.body.products).toHaveLength(10);
    const found = await request(app).get("/api/products?q=kettle");
    expect(found.body.products.map((p: { slug: string }) => p.slug)).toContain("electric-kettle-1-5-l");
    const store = await request(app).get("/api/store");
    expect(store.body.categories).toHaveLength(6);
  });

  it("shows one product with related items, and 404 for an unknown one", async () => {
    const res = await request(app).get("/api/products/pulse-wireless-earbuds");
    expect(res.body.product.name).toBe("Pulse Wireless Earbuds");
    expect(res.body.related).toHaveLength(4);
    expect((await request(app).get("/api/products/nothing-here")).status).toBe(404);
  });
});

describe("cart and checkout", () => {
  it("needs a delivery address before an order can be placed", async () => {
    const agent = await customer();
    await agent.put("/api/cart/glide-wireless-mouse").send({ qty: 1 }).expect(200);
    const res = await agent.post("/api/orders");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("ADDRESS_REQUIRED");
  });

  it("places an order: totals, a readable number, stock taken and the cart emptied", async () => {
    const agent = await customer();
    const before = (await ProductModel.findOne({ slug: "glide-wireless-mouse" }))!.stock;
    const order = await orderOf(agent, "glide-wireless-mouse", 2);
    expect(order.number).toMatch(/^BS-[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(order.total).toBe(998); // 2 × 499, free delivery from 499
    expect((await ProductModel.findOne({ slug: "glide-wireless-mouse" }))!.stock).toBe(before - 2);
    expect((await agent.get("/api/cart")).body.cart.count).toBe(0);
  });

  it("charges delivery below the free-delivery amount", async () => {
    const agent = await customer();
    const order = await orderOf(agent, "dark-chocolate-bar");
    expect(order.total).toBe(99 + 40);
  });

  it("lets only one of two buyers take the last item", async () => {
    await ProductModel.updateOne({ slug: "vista-43-smart-tv" }, { $set: { stock: 1 } });
    const a = await customer("a@example.com");
    const b = await customer("b@example.com");
    for (const agent of [a, b]) {
      await agent.put("/api/me/address").send(ADDRESS).expect(200);
      await agent.put("/api/cart/vista-43-smart-tv").send({ qty: 1 }).expect(200);
    }
    const results = await Promise.all([a.post("/api/orders"), b.post("/api/orders")]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await ProductModel.findOne({ slug: "vista-43-smart-tv" }))!.stock).toBe(0);
  });
});

describe("cancelling", () => {
  it("cancels a placed order and puts the stock back", async () => {
    const agent = await customer();
    const before = (await ProductModel.findOne({ slug: "orbit-smartwatch" }))!.stock;
    const order = await orderOf(agent, "orbit-smartwatch");
    const res = await agent.post(`/api/orders/${order.number}/cancel`).send({ reason: "Ordered by mistake" });
    expect(res.body.order.status).toBe("cancelled");
    expect(res.body.order.cancel.reason).toBe("Ordered by mistake");
    expect((await ProductModel.findOne({ slug: "orbit-smartwatch" }))!.stock).toBe(before);
  });

  it("refuses to cancel once the order has shipped, saying why", async () => {
    const agent = await customer();
    const team = await admin();
    const order = await orderOf(agent, "orbit-smartwatch");
    await team.post(`/api/admin/orders/${order.number}/advance`).expect(200); // packed
    await team.post(`/api/admin/orders/${order.number}/advance`).expect(200); // shipped
    const res = await agent.post(`/api/orders/${order.number}/cancel`).send({ reason: "Ordered by mistake" });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/shipped/);
  });

  it("accepts only the listed reasons", async () => {
    const agent = await customer();
    const order = await orderOf(agent, "orbit-smartwatch");
    expect((await agent.post(`/api/orders/${order.number}/cancel`).send({ reason: "because" })).status).toBe(400);
  });
});

describe("returns and refunds", () => {
  async function delivered(slug = "runner-sports-shoes") {
    const agent = await customer();
    const team = await admin();
    const order = await orderOf(agent, slug);
    for (let i = 0; i < 4; i++) await team.post(`/api/admin/orders/${order.number}/advance`).expect(200);
    return { agent, team, number: order.number };
  }

  it("cannot return before delivery", async () => {
    const agent = await customer();
    const order = await orderOf(agent, "runner-sports-shoes");
    const res = await agent.post(`/api/orders/${order.number}/return`).send({ reason: "Size or fit is not right" });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/after it is delivered/);
  });

  it("returns a delivered order once, then refunds it after pickup", async () => {
    const { agent, team, number } = await delivered();
    const res = await agent.post(`/api/orders/${number}/return`).send({ reason: "Size or fit is not right", details: "Too small" });
    expect(res.body.order.return.status).toBe("requested");
    expect((await agent.post(`/api/orders/${number}/return`).send({ reason: "Size or fit is not right" })).status).toBe(409);

    await team.post(`/api/admin/orders/${number}/return/advance`).expect(200); // approved
    const picked = await team.post(`/api/admin/orders/${number}/return/advance`); // picked up
    expect(picked.body.order.refund.status).toBe("pending");
    const refunded = await team.post(`/api/admin/orders/${number}/return/advance`);
    expect(refunded.body.order.return.status).toBe("refunded");
    expect(refunded.body.order.refund).toMatchObject({ status: "completed", amount: refunded.body.order.total });
  });

  it("closes the return window after 7 days", async () => {
    const { agent, number } = await delivered();
    await OrderModel.updateOne({ number }, { $set: { deliveredAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) } });
    const res = await agent.post(`/api/orders/${number}/return`).send({ reason: "No longer needed" });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/7-day/);
  });

  it("does not return grocery items", async () => {
    const { agent, number } = await delivered("basmati-rice-5-kg");
    const view = (await agent.get(`/api/orders/${number}`)).body.order;
    expect(view.canReturn).toBe(false);
    expect(view.returnBlockedReason).toMatch(/cannot be returned/);
  });

  it("lets the team decline a requested return with a note", async () => {
    const { agent, team, number } = await delivered();
    await agent.post(`/api/orders/${number}/return`).send({ reason: "No longer needed" }).expect(200);
    const res = await team.post(`/api/admin/orders/${number}/return/reject`).send({ note: "Item was used" });
    expect(res.body.order.return.status).toBe("rejected");
  });
});

describe("privacy", () => {
  it("never shows or changes another customer's order", async () => {
    const a = await customer("a@example.com");
    const b = await customer("b@example.com");
    const order = await orderOf(a, "orbit-smartwatch");
    expect((await b.get(`/api/orders/${order.number}`)).status).toBe(404);
    expect((await b.post(`/api/orders/${order.number}/cancel`).send({ reason: "Other" })).status).toBe(404);
    expect((await b.get("/api/orders")).body.orders).toHaveLength(0);
  });

  it("keeps the team's pages for the team", async () => {
    const agent = await customer();
    expect((await agent.get("/api/admin/orders")).status).toBe(403);
    expect((await request(app).get("/api/admin/orders")).status).toBe(401);
  });

  it("ignores a tampered session cookie", async () => {
    const res = await request(app).get("/api/me").set("Cookie", "bunty_session=eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.");
    expect(res.status).toBe(401);
  });
});
