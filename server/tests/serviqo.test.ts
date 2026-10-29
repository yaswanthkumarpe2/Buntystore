import { randomBytes } from "node:crypto";

import { jwtVerify } from "jose";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { loadEnv } from "../src/env";
import { ConnectorActionModel, ConnectorNonceModel, OrderModel, ProductModel, UserModel } from "../src/models";
import { ensureCatalog } from "../src/seed/catalogSeed";
import { IDENTITY_MINUTES, signRequest } from "../src/serviqo";

const CONNECTOR_SECRET = "connector-secret-connector-secret-0123456789";
const IDENTITY_SECRET = "identity-secret-identity-secret-0123456789ab";

let mongo: MongoMemoryServer;
const app = createApp({
  sessionSecret: "test-secret-test-secret-test-secret-123",
  production: false,
  authLimit: 1000,
  serviqo: { connectorSecret: CONNECTOR_SECRET, identitySecret: IDENTITY_SECRET },
});
const appWithoutServiqo = createApp({ sessionSecret: "test-secret-test-secret-test-secret-123", production: false, authLimit: 1000 });

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri("bunty-serviqo-test"));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await mongoose.connection.db!.dropDatabase();
  await Promise.all([
    ProductModel.syncIndexes(),
    UserModel.syncIndexes(),
    OrderModel.syncIndexes(),
    ConnectorNonceModel.syncIndexes(),
    ConnectorActionModel.syncIndexes(),
  ]);
  await ensureCatalog();
});

// ---------------------------------------------------------------- helpers

interface SignOptions {
  body?: unknown;
  secret?: string;
  timestamp?: number;
  nonce?: string;
  key?: string;
  /** Sign one body but send another. */
  sendBody?: string;
}

/** A request signed the way Serviqo signs it. */
function signed(method: "GET" | "POST", path: string, o: SignOptions = {}) {
  const raw = o.body === undefined ? "" : JSON.stringify(o.body);
  const timestamp = String(o.timestamp ?? Math.floor(Date.now() / 1000));
  const nonce = o.nonce ?? randomBytes(16).toString("hex");
  const signature = signRequest(o.secret ?? CONNECTOR_SECRET, method, path, timestamp, nonce, Buffer.from(raw));
  const req = (method === "GET" ? request(app).get(path) : request(app).post(path))
    .set("X-Serviqo-Timestamp", timestamp)
    .set("X-Serviqo-Nonce", nonce)
    .set("X-Serviqo-Signature", signature);
  if (o.key) req.set("Idempotency-Key", o.key);
  const sent = o.sendBody ?? raw;
  if (sent) req.set("Content-Type", "application/json").send(sent);
  return req;
}

const ADDRESS = { name: "Priya Sharma", phone: "9876543210", line1: "Flat 12, Green Park", city: "Hyderabad", state: "Telangana", pincode: "500081" };

async function customer(email = "priya@example.com") {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/signup").send({ name: "Priya", email, password: "a-good-password" });
  expect(res.status).toBe(201);
  return { agent, id: res.body.user.id as string };
}

async function orderOf(agent: ReturnType<typeof request.agent>, slug = "orbit-smartwatch") {
  await agent.put("/api/me/address").send(ADDRESS).expect(200);
  await agent.put(`/api/cart/${slug}`).send({ qty: 1 }).expect(200);
  const res = await agent.post("/api/orders");
  expect(res.status).toBe(201);
  return res.body.order.number as string;
}

async function markDelivered(number: string, daysAgo = 1) {
  await OrderModel.updateOne(
    { number },
    { $set: { status: "delivered", deliveredAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000) } },
  );
}

// ---------------------------------------------------------------- signing

describe("the signed door", () => {
  it("answers a correctly signed request", async () => {
    const res = await signed("GET", "/api/serviqo/policy");
    expect(res.status).toBe(200);
    expect(res.body.demo).toBe(true);
    expect(res.body.policy.returnWindowDays).toBe(7);
    expect(res.body.policy.cancelReasons).toContain("Ordered by mistake");
  });

  it("refuses an unsigned request", async () => {
    const res = await request(app).get("/api/serviqo/policy");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("SIGNATURE_REQUIRED");
  });

  it("refuses a request signed with the wrong secret", async () => {
    const res = await signed("GET", "/api/serviqo/policy", { secret: "not-the-secret-not-the-secret-0123456789" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("BAD_SIGNATURE");
  });

  it("refuses a timestamp outside the five-minute window, either way", async () => {
    const now = Math.floor(Date.now() / 1000);
    for (const timestamp of [now - 301, now + 301]) {
      const res = await signed("GET", "/api/serviqo/policy", { timestamp });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("STALE_REQUEST");
    }
  });

  it("refuses the same signed request a second time", async () => {
    const nonce = randomBytes(16).toString("hex");
    const timestamp = Math.floor(Date.now() / 1000);
    expect((await signed("GET", "/api/serviqo/policy", { nonce, timestamp })).status).toBe(200);
    const again = await signed("GET", "/api/serviqo/policy", { nonce, timestamp });
    expect(again.status).toBe(401);
    expect(again.body.error.code).toBe("REPLAYED_REQUEST");
  });

  it("refuses a body that was changed after signing", async () => {
    const { agent, id } = await customer();
    const number = await orderOf(agent);
    const res = await signed("POST", `/api/serviqo/customers/${id}/orders/${number}/cancel`, {
      body: { reason: "Ordered by mistake" },
      sendBody: JSON.stringify({ reason: "Other" }),
      key: "key-tampered-0001",
    });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("BAD_SIGNATURE");
    expect((await OrderModel.findOne({ number }))!.status).toBe("placed");
  });

  it("signs the path with its query, so a changed query is refused", async () => {
    const { id } = await customer();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(16).toString("hex");
    const signature = signRequest(CONNECTOR_SECRET, "GET", `/api/serviqo/customers/${id}/orders?limit=5`, timestamp, nonce, Buffer.alloc(0));
    const res = await request(app)
      .get(`/api/serviqo/customers/${id}/orders?limit=20`)
      .set("X-Serviqo-Timestamp", timestamp)
      .set("X-Serviqo-Nonce", nonce)
      .set("X-Serviqo-Signature", signature);
    expect(res.status).toBe(401);
  });

  it("is switched off entirely without a connector secret", async () => {
    expect((await request(appWithoutServiqo).get("/api/serviqo/policy")).status).toBe(404);
  });
});

// ---------------------------------------------------------------- reading

describe("what Serviqo can read", () => {
  it("summarises a customer without their address, phone or password", async () => {
    const { agent, id } = await customer();
    await orderOf(agent);
    const res = await signed("GET", `/api/serviqo/customers/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.customer).toMatchObject({ id, name: "Priya", email: "priya@example.com", orderCount: 1, openOrderCount: 1 });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain("9876543210");
    expect(text).not.toContain("Green Park");
    expect(text).not.toContain("passwordHash");
  });

  it("lists the newest orders first, five by default, with no address", async () => {
    const { agent, id } = await customer();
    const numbers: string[] = [];
    for (let i = 0; i < 6; i++) numbers.push(await orderOf(agent));
    const res = await signed("GET", `/api/serviqo/customers/${id}/orders`);
    expect(res.status).toBe(200);
    expect(res.body.orders).toHaveLength(5);
    expect(res.body.orders[0].number).toBe(numbers[5]);
    expect(res.body.orders[0]).toMatchObject({ status: "placed", canCancel: true, cancelBlockedReason: null, canReturn: false });
    expect(JSON.stringify(res.body)).not.toContain("9876543210");
    expect(res.body.orders[0]).not.toHaveProperty("address");
  });

  it("shows one order with the reason it cannot be returned", async () => {
    const { agent, id } = await customer();
    const number = await orderOf(agent, "basmati-rice-5-kg");
    await markDelivered(number);
    const res = await signed("GET", `/api/serviqo/customers/${id}/orders/${number}`);
    expect(res.status).toBe(200);
    expect(res.body.order.canReturn).toBe(false);
    expect(res.body.order.returnBlockedReason).toMatch(/cannot be returned/);
    expect(res.body.order.cancelBlockedReason).toMatch(/already shipped/);
  });

  it("never shows one customer's order under another customer", async () => {
    const a = await customer("a@example.com");
    const b = await customer("b@example.com");
    const number = await orderOf(a.agent);
    expect((await signed("GET", `/api/serviqo/customers/${b.id}/orders/${number}`)).status).toBe(404);
    expect((await signed("GET", `/api/serviqo/customers/${b.id}/orders`)).body.orders).toHaveLength(0);
  });

  it("answers not found for an unknown or malformed customer id", async () => {
    expect((await signed("GET", "/api/serviqo/customers/000000000000000000000000")).status).toBe(404);
    expect((await signed("GET", "/api/serviqo/customers/not-an-id")).status).toBe(404);
  });
});

// ---------------------------------------------------------------- acting

describe("what Serviqo can do after the customer confirms", () => {
  it("cancels once, and a retry with the same key gets the same answer", async () => {
    const { agent, id } = await customer();
    const number = await orderOf(agent);
    const path = `/api/serviqo/customers/${id}/orders/${number}/cancel`;
    const first = await signed("POST", path, { body: { reason: "Ordered by mistake" }, key: "cancel-key-0001" });
    expect(first.status).toBe(200);
    expect(first.body.order.status).toBe("cancelled");

    const retry = await signed("POST", path, { body: { reason: "Ordered by mistake" }, key: "cancel-key-0001" });
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual(first.body);
    expect((await OrderModel.findOne({ number }))!.timeline.filter((e) => e.status === "cancelled")).toHaveLength(1);

    const fresh = await signed("POST", path, { body: { reason: "Ordered by mistake" }, key: "cancel-key-0002" });
    expect(fresh.status).toBe(409);
    expect(fresh.body.error.code).toBe("ALREADY_CANCELLED");
  });

  it("lets two copies of the same request race without acting twice", async () => {
    const { agent, id } = await customer();
    const number = await orderOf(agent);
    const path = `/api/serviqo/customers/${id}/orders/${number}/cancel`;
    const results = await Promise.all([
      signed("POST", path, { body: { reason: "Other" }, key: "race-key-0001" }),
      signed("POST", path, { body: { reason: "Other" }, key: "race-key-0001" }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses[0]).toBe(200);
    expect([200, 409]).toContain(statuses[1]);
    expect((await OrderModel.findOne({ number }))!.timeline.filter((e) => e.status === "cancelled")).toHaveLength(1);
  });

  it("refuses to reuse a key for a different order", async () => {
    const { agent, id } = await customer();
    const one = await orderOf(agent);
    const two = await orderOf(agent);
    await signed("POST", `/api/serviqo/customers/${id}/orders/${one}/cancel`, { body: { reason: "Other" }, key: "shared-key-0001" }).expect(200);
    const res = await signed("POST", `/api/serviqo/customers/${id}/orders/${two}/cancel`, { body: { reason: "Other" }, key: "shared-key-0001" });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect((await OrderModel.findOne({ number: two }))!.status).toBe("placed");
  });

  it("still follows Bunty's rules: a shipped order cannot be cancelled", async () => {
    const { agent, id } = await customer();
    const number = await orderOf(agent);
    await OrderModel.updateOne({ number }, { $set: { status: "shipped" } });
    const res = await signed("POST", `/api/serviqo/customers/${id}/orders/${number}/cancel`, { body: { reason: "Other" }, key: "shipped-key-0001" });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/already shipped/);
  });

  it("needs an Idempotency-Key and one of the store's own reasons", async () => {
    const { agent, id } = await customer();
    const number = await orderOf(agent);
    const path = `/api/serviqo/customers/${id}/orders/${number}/cancel`;
    const noKey = await signed("POST", path, { body: { reason: "Other" } });
    expect(noKey.status).toBe(400);
    expect(noKey.body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    const madeUp = await signed("POST", path, { body: { reason: "The AI said so" }, key: "reason-key-0001" });
    expect(madeUp.status).toBe(400);
    expect((await OrderModel.findOne({ number }))!.status).toBe("placed");
  });

  it("cannot cancel another customer's order", async () => {
    const a = await customer("a@example.com");
    const b = await customer("b@example.com");
    const number = await orderOf(a.agent);
    const res = await signed("POST", `/api/serviqo/customers/${b.id}/orders/${number}/cancel`, { body: { reason: "Other" }, key: "other-key-0001" });
    expect(res.status).toBe(404);
    expect((await OrderModel.findOne({ number }))!.status).toBe("placed");
  });

  it("starts a return for a delivered order, once", async () => {
    const { agent, id } = await customer();
    const number = await orderOf(agent);
    await markDelivered(number);
    const path = `/api/serviqo/customers/${id}/orders/${number}/return`;
    const res = await signed("POST", path, { body: { reason: "Item is damaged" }, key: "return-key-0001" });
    expect(res.status).toBe(200);
    expect(res.body.order.return).toMatchObject({ status: "requested", reason: "Item is damaged" });
    expect(res.body.order.canReturn).toBe(false);
    const retry = await signed("POST", path, { body: { reason: "Item is damaged" }, key: "return-key-0001" });
    expect(retry.body).toEqual(res.body);
  });

  it("refuses a return after the seven-day window, in plain words", async () => {
    const { agent, id } = await customer();
    const number = await orderOf(agent);
    await markDelivered(number, 8);
    const res = await signed("POST", `/api/serviqo/customers/${id}/orders/${number}/return`, { body: { reason: "No longer needed" }, key: "late-key-0001" });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/7-day/);
  });
});

// ---------------------------------------------------------------- identity

describe("the pass for the Serviqo chat", () => {
  it("gives a signed-in customer a short-lived pass Serviqo can check", async () => {
    const { agent, id } = await customer();
    const res = await agent.get("/api/me/serviqo-identity");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const { payload, protectedHeader } = await jwtVerify(res.body.token, new TextEncoder().encode(IDENTITY_SECRET), {
      issuer: "bunty-store",
      audience: "serviqo",
      algorithms: ["HS256"],
    });
    expect(protectedHeader.alg).toBe("HS256");
    expect(payload).toMatchObject({ sub: id, email: "priya@example.com", name: "Priya" });
    expect(payload.exp! - payload.iat!).toBe(IDENTITY_MINUTES * 60);
    expect(typeof payload.jti).toBe("string");
    expect(JSON.stringify(payload)).not.toContain("9876543210");
  });

  it("gives nothing to someone who is not signed in", async () => {
    expect((await request(app).get("/api/me/serviqo-identity")).status).toBe(401);
  });

  it("is off without an identity secret", async () => {
    const agent = request.agent(appWithoutServiqo);
    await agent.post("/api/auth/signup").send({ name: "Priya", email: "p2@example.com", password: "a-good-password" }).expect(201);
    expect((await agent.get("/api/me/serviqo-identity")).status).toBe(404);
  });

  it("cannot be checked with the connector secret", async () => {
    const { agent } = await customer();
    const { token } = (await agent.get("/api/me/serviqo-identity")).body;
    await expect(jwtVerify(token, new TextEncoder().encode(CONNECTOR_SECRET))).rejects.toThrow();
  });
});

// ---------------------------------------------------------------- settings

describe("the connector's settings", () => {
  const base = { MONGODB_URI: "mongodb://x", SESSION_SECRET: "s".repeat(32) };

  it("treats empty secrets, as copied from .env.example, as off", () => {
    const env = loadEnv({ ...base, SERVIQO_CONNECTOR_SECRET: "", SERVIQO_IDENTITY_SECRET: "" });
    expect(env.SERVIQO_CONNECTOR_SECRET).toBeUndefined();
    expect(env.SERVIQO_IDENTITY_SECRET).toBeUndefined();
  });

  it("refuses a short secret, and the same secret for both jobs", () => {
    expect(() => loadEnv({ ...base, SERVIQO_CONNECTOR_SECRET: "too-short" })).toThrow(/at least 32/);
    const same = "x".repeat(40);
    expect(() => loadEnv({ ...base, SERVIQO_CONNECTOR_SECRET: same, SERVIQO_IDENTITY_SECRET: same })).toThrow(/different/);
  });
});
