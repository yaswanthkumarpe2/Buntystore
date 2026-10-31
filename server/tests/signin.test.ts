import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { hashPassword } from "../src/auth";
import { type Mail, type Mailer } from "../src/mail";
import { LoginCodeModel, LoginThrottleModel, UserModel } from "../src/models";

import { TEST_PASSWORD, signedInCustomer } from "./helpers";

const SITE = "https://bunty.test";
const SECRET = "test-secret-test-secret-test-secret-123";
const GOOGLE_ID = "1234-abc.apps.googleusercontent.com";

function memoryMailer(): Mailer & { sent: Mail[] } {
  const sent: Mail[] = [];
  return { on: true, sent, send: async (mail) => void sent.push(mail) };
}

// ---------------------------------------------------------------- a stand-in for Google

let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let googleKeys: JWTVerifyGetKey;
let idTokenClaims: Record<string, unknown> = {};
let lastTokenRequest: URLSearchParams | null = null;

const googleFetch = (async (_url: string, init?: RequestInit) => {
  lastTokenRequest = new URLSearchParams(String(init?.body));
  const idToken = await new SignJWT(idTokenClaims)
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer("https://accounts.google.com")
    .setAudience(GOOGLE_ID)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  return new Response(JSON.stringify({ id_token: idToken }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

const mailer = memoryMailer();
const app = createApp({
  sessionSecret: SECRET,
  production: false,
  authLimit: 1000,
  email: { mailer, siteUrl: SITE },
  google: { clientId: GOOGLE_ID, clientSecret: "google-secret-123", siteUrl: SITE, fetch: googleFetch, keys: (header, token) => googleKeys(header, token) },
  publicUrl: SITE,
});
const plainApp = createApp({ sessionSecret: SECRET, production: false, authLimit: 1000 });

let mongo: MongoMemoryServer;
beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  googleKeys = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" }] });
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri("bunty-signin-test"));
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  await mongoose.connection.db!.dropDatabase();
  await Promise.all([UserModel.syncIndexes(), LoginCodeModel.syncIndexes(), LoginThrottleModel.syncIndexes()]);
  mailer.sent.length = 0;
  idTokenClaims = {};
  lastTokenRequest = null;
});

const codeIn = (mail: Mail) => /Your code: (\d{6})/.exec(mail.text)![1]!;
const lastCode = () => codeIn(mailer.sent.at(-1)!);
/** Lets a test send a fresh code without waiting a minute. */
const allowResend = (email: string) => LoginCodeModel.updateOne({ email }, { $set: { lastSentAt: new Date(Date.now() - 61_000) } });

// ---------------------------------------------------------------- email code

describe("signing in with an email code", () => {
  it("creates an account for a new address: code, then name, then a welcome email", async () => {
    const agent = request.agent(app);
    const sent = await agent.post("/api/auth/code").send({ email: "New.Person@Example.com" }).expect(200);
    expect(sent.body).toEqual({ ok: true, resendIn: 60 });
    expect(mailer.sent[0]!.to).toBe("new.person@example.com");
    expect(mailer.sent[0]!.subject).toMatch(/^\d{6} is your Bunty Store code$/);
    expect(mailer.sent[0]!.text).toContain("create your account");
    expect(mailer.sent[0]!.sender).toBe("account");

    const code = lastCode();
    const ask = await agent.post("/api/auth/code/verify").send({ email: "new.person@example.com", code }).expect(200);
    expect(ask.body).toEqual({ needsName: true });

    const done = await agent.post("/api/auth/code/verify").send({ email: "new.person@example.com", code, name: "Asha Rao" }).expect(201);
    expect(done.body.user).toMatchObject({ name: "Asha Rao", email: "new.person@example.com", hasPassword: false, google: false });
    expect((await agent.get("/api/me")).body.user.email).toBe("new.person@example.com");
    expect((await UserModel.findOne({ email: "new.person@example.com" }))!.emailVerifiedAt).toBeInstanceOf(Date);

    await new Promise((r) => setTimeout(r, 20));
    const welcome = mailer.sent.find((m) => m.subject === "Welcome to Bunty Store")!;
    expect(welcome.sender).toBe("hello");
    expect(welcome.text).toContain(`${SITE}/c/electronics`);
    // the code works once
    await request(app).post("/api/auth/code/verify").send({ email: "new.person@example.com", code }).expect(400);
  });

  it("signs an existing customer in, with no name needed", async () => {
    await UserModel.create({ name: "Priya", email: "priya@example.com" });
    const agent = request.agent(app);
    await agent.post("/api/auth/code").send({ email: "priya@example.com" }).expect(200);
    expect(mailer.sent[0]!.text).toContain("to sign in");
    const res = await agent.post("/api/auth/code/verify").send({ email: "priya@example.com", code: lastCode() }).expect(200);
    expect(res.body.user.name).toBe("Priya");
    expect(mailer.sent.some((m) => m.subject.includes("Welcome"))).toBe(false);
  });

  it("answers the same for addresses with and without an account", async () => {
    await UserModel.create({ name: "Priya", email: "priya@example.com" });
    const a = await request(app).post("/api/auth/code").send({ email: "priya@example.com" });
    const b = await request(app).post("/api/auth/code").send({ email: "nobody@example.com" });
    expect(a.status).toBe(b.status);
    expect(a.body).toEqual(b.body);
  });

  it("keeps only a keyed hash of the code", async () => {
    await request(app).post("/api/auth/code").send({ email: "priya@example.com" });
    const row = await LoginCodeModel.findOne({ email: "priya@example.com" }).lean();
    expect(row!.codeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(row)).not.toContain(lastCode());
  });

  it("sends one code a minute and five an hour", async () => {
    const send = () => request(app).post("/api/auth/code").send({ email: "priya@example.com" });
    await send().expect(200);
    const again = await send().expect(200);
    expect(again.body.resendIn).toBeGreaterThan(50);
    expect(mailer.sent).toHaveLength(1);
    for (let i = 0; i < 4; i++) {
      await allowResend("priya@example.com");
      await send().expect(200);
    }
    expect(mailer.sent).toHaveLength(5);
    await allowResend("priya@example.com");
    expect((await send()).status).toBe(429);
  });

  it("gives up on a code after five wrong tries", async () => {
    await request(app).post("/api/auth/code").send({ email: "priya@example.com" });
    const right = lastCode();
    const wrong = right === "000000" ? "111111" : "000000";
    for (let i = 4; i >= 1; i--) {
      const res = await request(app).post("/api/auth/code/verify").send({ email: "priya@example.com", code: wrong }).expect(400);
      expect(res.body.error.message).toContain(`${i} tries left`);
    }
    const fifth = await request(app).post("/api/auth/code/verify").send({ email: "priya@example.com", code: wrong }).expect(400);
    expect(fifth.body.error.code).toBe("CODE_EXPIRED");
    // even the right code no longer works
    await request(app).post("/api/auth/code/verify").send({ email: "priya@example.com", code: right, name: "Priya" }).expect(400);
  });

  it("does not accept an expired code", async () => {
    await request(app).post("/api/auth/code").send({ email: "priya@example.com" });
    await LoginCodeModel.updateOne({ email: "priya@example.com" }, { $set: { codeExpiresAt: new Date(Date.now() - 1000) } });
    const res = await request(app).post("/api/auth/code/verify").send({ email: "priya@example.com", code: lastCode(), name: "Priya" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("CODE_EXPIRED");
  });

  it("is off, and says so to the page, when email is off", async () => {
    expect((await request(plainApp).post("/api/auth/code").send({ email: "priya@example.com" })).status).toBe(404);
    const store = (await request(plainApp).get("/api/store")).body;
    expect(store).toMatchObject({ emailSignIn: false, googleSignIn: false });
    expect((await request(app).get("/api/store")).body).toMatchObject({ emailSignIn: true, googleSignIn: true });
  });
});

// ---------------------------------------------------------------- password

describe("signing in with a password", () => {
  it("slows an address down after five wrong passwords, for accounts and non-accounts alike", async () => {
    await UserModel.create({ name: "Priya", email: "priya@example.com", passwordHash: await hashPassword(TEST_PASSWORD) });
    for (const address of ["priya@example.com", "nobody@example.com"]) {
      for (let i = 0; i < 5; i++) {
        expect((await request(app).post("/api/auth/login").send({ email: address, password: "wrong-password" })).status).toBe(401);
      }
      const locked = await request(app).post("/api/auth/login").send({ email: address, password: TEST_PASSWORD });
      expect(locked.status).toBe(429);
      expect(locked.body.error.message).toContain("email code");
    }
  });

  it("an email code still works while passwords are slowed down, and clears the slow-down", async () => {
    await UserModel.create({ name: "Priya", email: "priya@example.com", passwordHash: await hashPassword(TEST_PASSWORD) });
    for (let i = 0; i < 5; i++) await request(app).post("/api/auth/login").send({ email: "priya@example.com", password: "wrong-password" });
    await request(app).post("/api/auth/code").send({ email: "priya@example.com" });
    await request(app).post("/api/auth/code/verify").send({ email: "priya@example.com", code: lastCode() }).expect(200);
    await request(app).post("/api/auth/login").send({ email: "priya@example.com", password: TEST_PASSWORD }).expect(200);
  });

  it("an account with no password cannot be signed into with one", async () => {
    await UserModel.create({ name: "Asha", email: "asha@example.com" });
    const res = await request(app).post("/api/auth/login").send({ email: "asha@example.com", password: "anything-at-all" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("WRONG_DETAILS");
  });

  it("there is no sign-up without proving the email", async () => {
    const res = await request(app).post("/api/auth/signup").send({ name: "X", email: "x@example.com", password: "a-good-password" });
    expect(res.status).toBe(404);
    expect(await UserModel.exists({ email: "x@example.com" })).toBeNull();
  });
});

// ---------------------------------------------------------------- account security

describe("account security", () => {
  it("adds a password to a code-only account, turning down easy ones, and emails about it", async () => {
    await UserModel.create({ name: "Asha", email: "asha@example.com" });
    const agent = request.agent(app);
    await agent.post("/api/auth/code").send({ email: "asha@example.com" });
    await agent.post("/api/auth/code/verify").send({ email: "asha@example.com", code: lastCode() }).expect(200);

    const weak = await agent.post("/api/auth/password").send({ password: "password123" });
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe("WEAK_PASSWORD");

    const res = await agent.post("/api/auth/password").send({ password: "mango-river-42" }).expect(200);
    expect(res.body.user.hasPassword).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(mailer.sent.at(-1)!.subject).toBe("A password was added to your Bunty Store account");
    await request(app).post("/api/auth/login").send({ email: "asha@example.com", password: "mango-river-42" }).expect(200);
  });

  it("changing a password needs the current one and signs other devices out", async () => {
    const { agent } = await signedInCustomer(app);
    const other = request.agent(app);
    await other.post("/api/auth/login").send({ email: "priya@example.com", password: TEST_PASSWORD }).expect(200);

    expect((await agent.post("/api/auth/password").send({ current: "not-it", password: "mango-river-42" })).status).toBe(400);
    await agent.post("/api/auth/password").send({ current: TEST_PASSWORD, password: "mango-river-42" }).expect(200);
    expect((await agent.get("/api/me")).status).toBe(200);
    expect((await other.get("/api/me")).status).toBe(401);
  });

  it("signs out everywhere else, keeping this device", async () => {
    const { agent } = await signedInCustomer(app);
    const other = request.agent(app);
    await other.post("/api/auth/login").send({ email: "priya@example.com", password: TEST_PASSWORD }).expect(200);
    await agent.post("/api/auth/sign-out-everywhere").expect(200);
    expect((await agent.get("/api/me")).status).toBe(200);
    expect((await other.get("/api/me")).status).toBe(401);
  });

  it("turns away changes sent from another website", async () => {
    const res = await request(app).post("/api/auth/code").set("Origin", "https://evil.example").send({ email: "priya@example.com" });
    expect(res.status).toBe(403);
    await request(app).post("/api/auth/code").set("Origin", SITE).send({ email: "priya@example.com" }).expect(200);
    // reading is fine from anywhere
    await request(app).get("/api/store").set("Origin", "https://evil.example").expect(200);
  });
});

// ---------------------------------------------------------------- Google

async function googleRoundTrip(claims: Record<string, unknown>, next = "/orders") {
  const agent = request.agent(app);
  const start = await agent.get(`/api/auth/google?next=${encodeURIComponent(next)}`).expect(302);
  const to = new URL(start.headers.location!);
  expect(to.origin).toBe("https://accounts.google.com");
  expect(to.searchParams.get("redirect_uri")).toBe(`${SITE}/api/auth/google/callback`);
  expect(to.searchParams.get("code_challenge_method")).toBe("S256");
  idTokenClaims = { nonce: to.searchParams.get("nonce"), ...claims };
  const back = await agent.get(`/api/auth/google/callback?code=abc&state=${to.searchParams.get("state")}`).expect(302);
  return { agent, location: back.headers.location as string, challenge: to.searchParams.get("code_challenge")! };
}

describe("continuing with Google", () => {
  it("creates a verified account, sends the welcome email and returns to the page", async () => {
    const { agent, location } = await googleRoundTrip({ sub: "g-1", email: "Asha@Gmail.com", email_verified: true, name: "Asha Rao" });
    expect(location).toBe("/orders");
    const me = (await agent.get("/api/me")).body.user;
    expect(me).toMatchObject({ email: "asha@gmail.com", name: "Asha Rao", google: true, hasPassword: false });
    expect(lastTokenRequest!.get("code_verifier")).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    expect(mailer.sent.some((m) => m.subject === "Welcome to Bunty Store")).toBe(true);
  });

  it("joins an existing account with the same address, and signs in by Google's id next time", async () => {
    await UserModel.create({ name: "Priya", email: "priya@example.com", passwordHash: await hashPassword(TEST_PASSWORD) });
    await googleRoundTrip({ sub: "g-2", email: "priya@example.com", email_verified: true, name: "P" });
    const linked = await UserModel.findOne({ email: "priya@example.com" });
    expect(linked!.googleId).toBe("g-2");
    expect(linked!.name).toBe("Priya");
    const again = await googleRoundTrip({ sub: "g-2", email: "renamed@example.com", email_verified: true });
    expect((await again.agent.get("/api/me")).body.user.email).toBe("priya@example.com");
  });

  it("refuses an address Google has not verified", async () => {
    const { agent, location } = await googleRoundTrip({ sub: "g-3", email: "x@example.com", email_verified: false });
    expect(location).toBe("/signin?error=google_unverified");
    expect((await agent.get("/api/me")).status).toBe(401);
  });

  it("refuses a token for another sign-in (wrong nonce) or a wrong state", async () => {
    const agent = request.agent(app);
    const start = await agent.get("/api/auth/google").expect(302);
    const state = new URL(start.headers.location!).searchParams.get("state");
    idTokenClaims = { nonce: "someone-elses", sub: "g-4", email: "x@example.com", email_verified: true };
    expect((await agent.get(`/api/auth/google/callback?code=abc&state=${state}`)).headers.location).toBe("/signin?error=google");

    const second = request.agent(app);
    await second.get("/api/auth/google").expect(302);
    expect((await second.get("/api/auth/google/callback?code=abc&state=forged")).headers.location).toBe("/signin?error=google");
    expect(await UserModel.exists({ email: "x@example.com" })).toBeNull();
  });

  it("never sends people on to another website", async () => {
    const { location } = await googleRoundTrip({ sub: "g-5", email: "y@example.com", email_verified: true }, "//evil.example/steal");
    expect(location).toBe("/");
  });

  it("is off when Google is not set up", async () => {
    expect((await request(plainApp).get("/api/auth/google")).status).toBe(404);
  });
});
