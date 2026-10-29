import { randomBytes } from "node:crypto";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import { hashPassword } from "../src/auth";
import { orderMail } from "../src/emails";
import { loadEnv } from "../src/env";
import { resendMailer, type Mail, type Mailer } from "../src/mail";
import { ConnectorNonceModel, OrderModel, PasswordResetModel, ProductModel, UserModel, type OrderDoc } from "../src/models";
import { CANCEL_REASONS, RETURN_REASONS } from "../src/policy";
import { ensureCatalog } from "../src/seed/catalogSeed";
import { signRequest } from "../src/serviqo";

const SITE = "https://bunty.test";
const CONNECTOR_SECRET = "connector-secret-connector-secret-0123456789";

/** Keeps every email instead of sending it. */
function memoryMailer(): Mailer & { sent: Mail[] } {
  const sent: Mail[] = [];
  return { on: true, sent, send: async (mail) => void sent.push(mail) };
}

const mailer = memoryMailer();
const app = createApp({
  sessionSecret: "test-secret-test-secret-test-secret-123",
  production: false,
  authLimit: 1000,
  email: { mailer, siteUrl: SITE },
  serviqo: { connectorSecret: CONNECTOR_SECRET },
});
const appWithoutEmail = createApp({ sessionSecret: "test-secret-test-secret-test-secret-123", production: false, authLimit: 1000 });

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri("bunty-email-test"));
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
    PasswordResetModel.syncIndexes(),
    ConnectorNonceModel.syncIndexes(),
  ]);
  await ensureCatalog();
  mailer.sent.length = 0;
});

// ---------------------------------------------------------------- helpers

const ADDRESS = { name: "Priya Sharma", phone: "9876543210", line1: "Flat 12, Green Park", city: "Hyderabad", state: "Telangana", pincode: "500081" };

async function customer(email = "priya@example.com", name = "Priya Sharma") {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/signup").send({ name, email, password: "a-good-password" });
  expect(res.status).toBe(201);
  return { agent, id: res.body.user.id as string };
}

async function admin() {
  await UserModel.create({ name: "Team", email: "team@example.com", passwordHash: await hashPassword("team-password"), role: "admin" });
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ email: "team@example.com", password: "team-password" }).expect(200);
  return agent;
}

async function orderOf(agent: ReturnType<typeof request.agent>, slug = "orbit-smartwatch") {
  await agent.put("/api/me/address").send(ADDRESS).expect(200);
  await agent.put(`/api/cart/${slug}`).send({ qty: 1 }).expect(200);
  const res = await agent.post("/api/orders");
  expect(res.status).toBe(201);
  return res.body.order.number as string;
}

/** Emails go out in the background; this waits until `count` have been sent. */
async function sentMails(count: number) {
  await vi.waitFor(() => expect(mailer.sent).toHaveLength(count));
  return mailer.sent;
}

/** The token from the newest password reset email's link. */
const tokenFrom = (mail: Mail) => mail.text.match(/reset-password#([A-Za-z0-9_-]+)/)![1]!;

// ---------------------------------------------------------------- order emails

describe("order emails", () => {
  it("tells the customer their order was placed: number, items, total, a link, and the demo label", async () => {
    const { agent } = await customer();
    const number = await orderOf(agent);
    const [mail] = await sentMails(1);
    expect(mail!.to).toBe("priya@example.com");
    expect(mail!.subject).toBe(`Order ${number} placed`);
    expect(mail!.idempotencyKey).toBe(`${number}:placed`);
    expect(mail!.text).toContain("Hi Priya,");
    expect(mail!.text).toContain(`${SITE}/orders/${number}`);
    expect(mail!.text).toContain("Nothing is really charged");
    expect(mail!.html).toContain(`href="${SITE}/orders/${number}"`);
    // never the delivery address or phone
    expect(mail!.text).not.toContain(ADDRESS.phone);
    expect(mail!.html).not.toContain(ADDRESS.line1);
  });

  it("escapes what people typed", async () => {
    const { agent } = await customer("x@example.com", "<b>Sneaky</b> & co");
    await orderOf(agent);
    const [mail] = await sentMails(1);
    expect(mail!.html).toContain("Hi &lt;b&gt;Sneaky&lt;/b&gt;,");
    expect(mail!.html).not.toContain("<b>Sneaky");
  });

  it("follows the order: shipped, out for delivery and delivered, but not packed", async () => {
    const { agent } = await customer();
    const number = await orderOf(agent);
    const team = await admin();
    await sentMails(1);
    for (let i = 0; i < 4; i++) await team.post(`/api/admin/orders/${number}/advance`).expect(200);
    const mails = await sentMails(4);
    expect(mails.map((m) => m.subject)).toEqual([
      `Order ${number} placed`,
      `Your order ${number} has shipped`,
      `Out for delivery: ${number}`,
      `Delivered: ${number}`,
    ]);
  });

  it("confirms a cancellation, whether the customer or the Serviqo assistant cancelled", async () => {
    const { agent, id } = await customer();
    const first = await orderOf(agent);
    await agent.post(`/api/orders/${first}/cancel`).send({ reason: CANCEL_REASONS[0] }).expect(200);

    const second = await orderOf(agent);
    const path = `/api/serviqo/customers/${id}/orders/${second}/cancel`;
    const raw = JSON.stringify({ reason: CANCEL_REASONS[0] });
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(16).toString("hex");
    await request(app)
      .post(path)
      .set("X-Serviqo-Timestamp", ts)
      .set("X-Serviqo-Nonce", nonce)
      .set("X-Serviqo-Signature", signRequest(CONNECTOR_SECRET, "POST", path, ts, nonce, Buffer.from(raw)))
      .set("Idempotency-Key", "cancel-key-0001")
      .set("Content-Type", "application/json")
      .send(raw)
      .expect(200);

    const mails = await sentMails(4);
    const cancelled = mails.filter((m) => m.subject.endsWith("cancelled"));
    expect(cancelled.map((m) => m.subject)).toEqual([`Order ${first} cancelled`, `Order ${second} cancelled`]);
    expect(cancelled[0]!.text).toContain("Nothing was charged");
  });

  it("follows a return through to the refund, and explains a declined one", async () => {
    const { agent } = await customer();
    const number = await orderOf(agent);
    await OrderModel.updateOne({ number }, { $set: { status: "delivered", deliveredAt: new Date() } });
    await agent.post(`/api/orders/${number}/return`).send({ reason: RETURN_REASONS[0] }).expect(200);
    const team = await admin();
    for (let i = 0; i < 3; i++) await team.post(`/api/admin/orders/${number}/return/advance`).expect(200);
    const mails = await sentMails(5);
    expect(mails.slice(1).map((m) => m.subject)).toEqual([
      `Return requested for ${number}`,
      `Return approved for ${number}`,
      `Return picked up for ${number}`,
      `Refund complete for ${number}`,
    ]);

    const other = await orderOf(agent);
    await OrderModel.updateOne({ number: other }, { $set: { status: "delivered", deliveredAt: new Date() } });
    await agent.post(`/api/orders/${other}/return`).send({ reason: RETURN_REASONS[0] }).expect(200);
    await team.post(`/api/admin/orders/${other}/return/reject`).send({ note: "The seal was broken" }).expect(200);
    const all = await sentMails(8);
    expect(all.at(-1)!.subject).toBe(`Return declined for ${other}`);
    expect(all.at(-1)!.text).toContain("The seal was broken");
  });

  it("sends nothing, and the order still goes through, when email is off", async () => {
    const agent = request.agent(appWithoutEmail);
    await agent.post("/api/auth/signup").send({ name: "Priya", email: "p@example.com", password: "a-good-password" }).expect(201);
    await agent.put("/api/me/address").send(ADDRESS).expect(200);
    await agent.put("/api/cart/orbit-smartwatch").send({ qty: 1 }).expect(200);
    await agent.post("/api/orders").expect(201);
    await new Promise((r) => setTimeout(r, 50));
    expect(mailer.sent).toHaveLength(0);
  });

  it("writes the delivered email with the return deadline", () => {
    const order = {
      number: "BS-TEST0001",
      items: [{ name: "Orbit Smartwatch", qty: 1, price: 2999 }],
      total: 2999,
      expectedDelivery: new Date("2026-11-01T06:00:00Z"),
      deliveredAt: new Date("2026-11-01T06:00:00Z"),
      cancel: null,
      return: null,
      refund: null,
    } as unknown as OrderDoc;
    const mail = orderMail(order, "delivered", { name: "Priya", email: "p@example.com" }, SITE);
    expect(mail.text).toContain("return eligible items until Sun, 8 Nov");
    expect(mail.text).toContain("Orbit Smartwatch x 1: ₹2,999");
  });
});

// ---------------------------------------------------------------- forgot password

describe("forgot password", () => {
  it("is offered only when email is on", async () => {
    expect((await request(app).get("/api/store")).body.passwordReset).toBe(true);
    expect((await request(appWithoutEmail).get("/api/store")).body.passwordReset).toBe(false);
    const res = await request(appWithoutEmail).post("/api/auth/forgot").send({ email: "p@example.com" });
    expect(res.status).toBe(404);
  });

  it("answers the same for an unknown email, and sends nothing", async () => {
    await customer();
    const known = await request(app).post("/api/auth/forgot").send({ email: "priya@example.com" });
    const unknown = await request(app).post("/api/auth/forgot").send({ email: "nobody@example.com" });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(unknown.body).toEqual(known.body);
    const mails = await sentMails(1);
    expect(mails[0]!.to).toBe("priya@example.com");
  });

  it("sends a one-time link in the #fragment, and keeps only its hash", async () => {
    await customer();
    await request(app).post("/api/auth/forgot").send({ email: "priya@example.com" }).expect(200);
    const [mail] = await sentMails(1);
    expect(mail!.subject).toBe("Reset your Bunty Store password");
    expect(mail!.text).toContain(`${SITE}/reset-password#`);
    const token = tokenFrom(mail!);
    const row = await PasswordResetModel.findOne().lean();
    expect(row!.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(row!.tokenHash).not.toContain(token);
  });

  it("sets the new password, signs out every other session, and signs in here", async () => {
    const { agent: oldSession } = await customer();
    await oldSession.get("/api/me").expect(200);
    await request(app).post("/api/auth/forgot").send({ email: "priya@example.com" }).expect(200);
    const token = tokenFrom((await sentMails(1))[0]!);

    const here = request.agent(app);
    const res = await here.post("/api/auth/reset").send({ token, password: "a-brand-new-password" });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("priya@example.com");
    await here.get("/api/me").expect(200);
    expect((await oldSession.get("/api/me")).status).toBe(401);

    await request(app).post("/api/auth/login").send({ email: "priya@example.com", password: "a-good-password" }).expect(401);
    await request(app).post("/api/auth/login").send({ email: "priya@example.com", password: "a-brand-new-password" }).expect(200);

    const mails = await sentMails(2);
    expect(mails[1]!.subject).toBe("Your Bunty Store password was changed");
  });

  it("refuses a link that was used, has expired, or was made up", async () => {
    await customer();
    await request(app).post("/api/auth/forgot").send({ email: "priya@example.com" }).expect(200);
    const token = tokenFrom((await sentMails(1))[0]!);
    await request(app).post("/api/auth/reset").send({ token, password: "a-brand-new-password" }).expect(200);
    const again = await request(app).post("/api/auth/reset").send({ token, password: "another-password-1" });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe("RESET_LINK_INVALID");

    const madeUp = await request(app).post("/api/auth/reset").send({ token: "x".repeat(43), password: "another-password-1" });
    expect(madeUp.body.error.code).toBe("RESET_LINK_INVALID");

    await PasswordResetModel.deleteMany({});
    await request(app).post("/api/auth/forgot").send({ email: "priya@example.com" }).expect(200);
    const late = tokenFrom((await sentMails(3))[2]!);
    await PasswordResetModel.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await request(app).post("/api/auth/reset").send({ token: late, password: "another-password-1" });
    expect(expired.body.error.code).toBe("RESET_LINK_INVALID");
  });

  it("sends at most one email per account every 2 minutes, and only the newest link works", async () => {
    await customer();
    await request(app).post("/api/auth/forgot").send({ email: "priya@example.com" }).expect(200);
    await request(app).post("/api/auth/forgot").send({ email: "priya@example.com" }).expect(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(mailer.sent).toHaveLength(1);
    expect(await PasswordResetModel.countDocuments()).toBe(1);
  });

  it("needs a good new password", async () => {
    await customer();
    await request(app).post("/api/auth/forgot").send({ email: "priya@example.com" }).expect(200);
    const token = tokenFrom((await sentMails(1))[0]!);
    const res = await request(app).post("/api/auth/reset").send({ token, password: "short" });
    expect(res.status).toBe(400);
    // the link is still good after a refused password
    await request(app).post("/api/auth/reset").send({ token, password: "a-brand-new-password" }).expect(200);
  });
});

// ---------------------------------------------------------------- Resend and settings

describe("sending through Resend", () => {
  const mail: Mail = { to: "p@example.com", subject: "Hi", text: "Hello", html: "<p>Hello</p>", idempotencyKey: "BS-1:placed" };

  it("posts one email with the key, the sender and an idempotency key", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "1" }), { status: 200 });
    }) as unknown as typeof fetch;
    await resendMailer({ apiKey: "re_test_0123456789", from: "Bunty Store <orders@bunty.test>", fetch: fake }).send(mail);
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer re_test_0123456789");
    expect(headers["idempotency-key"]).toBe("BS-1:placed");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      from: "Bunty Store <orders@bunty.test>",
      to: ["p@example.com"],
      subject: "Hi",
      text: "Hello",
      html: "<p>Hello</p>",
    });
  });

  it("fails loudly when Resend refuses, so the log says so", async () => {
    const fake = (async () => new Response("{}", { status: 403 })) as unknown as typeof fetch;
    await expect(resendMailer({ apiKey: "re_test_0123456789", from: "orders@bunty.test", fetch: fake }).send(mail)).rejects.toThrow(
      "Resend answered 403",
    );
  });
});

describe("the email settings", () => {
  const base = { MONGODB_URI: "mongodb://x", SESSION_SECRET: "s".repeat(32) };
  const on = { RESEND_API_KEY: "re_abcdefghij_0123", EMAIL_FROM: "Bunty Store <orders@bunty.me>", PUBLIC_URL: "https://bunty.me" };

  it("accepts a full set, and treats empty values as off", () => {
    expect(loadEnv({ ...base, ...on }).PUBLIC_URL).toBe("https://bunty.me");
    expect(loadEnv({ ...base, RESEND_API_KEY: "", EMAIL_FROM: "", PUBLIC_URL: "" }).RESEND_API_KEY).toBeUndefined();
  });

  it("refuses a key without a sender or an address, and malformed values", () => {
    expect(() => loadEnv({ ...base, ...on, EMAIL_FROM: "" })).toThrow(/EMAIL_FROM/);
    expect(() => loadEnv({ ...base, ...on, PUBLIC_URL: "" })).toThrow(/PUBLIC_URL/);
    expect(() => loadEnv({ ...base, ...on, RESEND_API_KEY: "sk_live_123" })).toThrow(/re_/);
    expect(() => loadEnv({ ...base, ...on, EMAIL_FROM: "Bunty Store" })).toThrow(/EMAIL_FROM/);
    expect(() => loadEnv({ ...base, ...on, PUBLIC_URL: "http://bunty.me" })).toThrow(/https/);
  });
});
