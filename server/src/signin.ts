/**
 * Signing in: a 6-digit code by email (which also creates new accounts),
 * "Continue with Google", and a password for accounts that have one.
 *
 * Every new account proves its email first (the code, or Google's verified
 * address), so nobody can open an account in someone else's name. Wrong codes
 * and wrong passwords are limited per address, and the answers never say
 * whether an account exists.
 */
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

import { Router, type RequestHandler } from "express";
import { SignJWT, createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";

import { dummyVerify, hashPassword, requireUser, verifyPassword, type createSessions } from "./auth";
import { CODE_MINUTES, passwordAddedMail, passwordChangedMail, signInCodeMail, welcomeMail, type EmailSetup } from "./emails";
import { HttpError, parse } from "./errors";
import { sendLater } from "./mail";
import { LoginCodeModel, LoginThrottleModel, UserModel, type UserDoc } from "./models";

type Sessions = ReturnType<typeof createSessions>;

/** "Continue with Google": off until a Google OAuth client is set up. */
export interface GoogleSetup {
  clientId: string;
  clientSecret: string;
  /** The site's public address; Google sends people back to {siteUrl}/api/auth/google/callback. */
  siteUrl: string;
  /** For tests: Google's token endpoint and signing keys. */
  fetch?: typeof fetch;
  keys?: JWTVerifyGetKey;
}

const MINUTE = 60 * 1000;
/** A new code can be sent once a minute, at most five an hour, per address. */
const RESEND_SECONDS = 60;
const CODES_PER_HOUR = 5;
const WRONG_CODES = 5;
/** Five wrong passwords for an address: wait 15 minutes, or sign in with an email code. */
const WRONG_PASSWORDS = 5;
const COOL_DOWN_MINUTES = 15;

const email = z.string().trim().toLowerCase().email("Enter a valid email address").max(200);
const password = z.string().min(8, "Use at least 8 characters").max(200);
const code = z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from the email");
const name = z.string().trim().min(2, "Enter your name").max(100);

/** Passwords that are guessed first. */
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password12", "password123", "12345678", "123456789", "1234567890", "11111111",
  "00000000", "qwertyui", "qwerty123", "iloveyou", "abcd1234", "abc12345", "letmein1", "welcome1", "welcome123",
  "admin123", "india123", "sunshine", "princess", "football", "baseball", "superman", "trustno1", "passw0rd",
  "bunty123", "buntystore",
]);

/** The account as the site sees it: never the password hash or Google's id. */
export function publicUser(u: Pick<UserDoc, "_id" | "name" | "email" | "role" | "address" | "passwordHash" | "googleId">) {
  return {
    id: u._id.toString(),
    name: u.name,
    email: u.email,
    role: u.role,
    address: u.address ?? null,
    hasPassword: Boolean(u.passwordHash),
    google: Boolean(u.googleId),
  };
}

/** Only a path on this site, never another site or a protocol-relative "//host". */
export function safeNext(v: unknown): string {
  return typeof v === "string" && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") && v.length < 300 ? v : "/";
}

/** Turns down passwords that are guessed first: the common ones and the email itself. */
export function checkNewPassword(pw: string, emailAddress: string) {
  const lower = pw.toLowerCase();
  if (COMMON_PASSWORDS.has(lower) || lower === emailAddress.toLowerCase() || lower === emailAddress.split("@")[0]) {
    throw new HttpError(400, "WEAK_PASSWORD", "This password is too easy to guess. Try a longer phrase, or mix in words and numbers.");
  }
}

export function signinRouter(
  sessions: Sessions,
  opts: { sessionSecret: string; limiter: RequestHandler; email?: EmailSetup; google?: GoogleSetup },
): Router {
  const r = Router();
  const { limiter } = opts;
  // the code is kept as an HMAC, so a copy of the database alone cannot be used to try all million codes
  const codeKey = createHash("sha256").update(`bunty-login-code:${opts.sessionSecret}`).digest();
  const hashCode = (address: string, c: string) => createHmac("sha256", codeKey).update(`${address}:${c}`).digest("hex");

  async function signedIn(res: Parameters<Sessions["issue"]>[0], user: UserDoc) {
    await sessions.issue(res, { id: user._id.toString(), role: user.role === "admin" ? "admin" : "customer" }, user.sessionVersion);
  }

  // ---------------------------------------------------------------- email code

  /** Emails a code. The answer is the same for every address, with or without an account. */
  r.post("/auth/code", limiter, async (req, res) => {
    const setup = opts.email;
    if (!setup) throw new HttpError(404, "NOT_AVAILABLE", "Signing in by email is not set up on this store.");
    const body = parse(z.object({ email }), req.body);
    const now = new Date();
    const row = await LoginCodeModel.findOne({ email: body.email });

    if (row && now.getTime() - row.lastSentAt.getTime() < RESEND_SECONDS * 1000) {
      // a code went out less than a minute ago: keep using that one
      res.json({ ok: true, resendIn: Math.ceil((row.lastSentAt.getTime() + RESEND_SECONDS * 1000 - now.getTime()) / 1000) });
      return;
    }
    // the hour starts with the first code; the row (and the count) goes when it ends
    const sameHour = row !== null && row.purgeAt > now;
    if (sameHour && row.sentThisHour >= CODES_PER_HOUR) {
      throw new HttpError(429, "TOO_MANY_CODES", "Too many codes for this email. Please wait a while and try again.");
    }

    const c = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const codeExpiresAt = new Date(now.getTime() + CODE_MINUTES * MINUTE);
    const hourEnds = sameHour ? row.purgeAt : new Date(now.getTime() + 60 * MINUTE);
    await LoginCodeModel.updateOne(
      { email: body.email },
      {
        $set: {
          codeHash: hashCode(body.email, c),
          codeExpiresAt,
          wrongTries: 0,
          lastSentAt: now,
          sentThisHour: sameHour ? row.sentThisHour + 1 : 1,
          // the row must outlive the code it holds
          purgeAt: hourEnds > codeExpiresAt ? hourEnds : codeExpiresAt,
        },
      },
      { upsert: true },
    );
    const exists = await UserModel.exists({ email: body.email });
    sendLater(setup.mailer, signInCodeMail(body.email, c, !exists), "sign-in code");
    res.json({ ok: true, resendIn: RESEND_SECONDS });
  });

  /**
   * Checks the code and signs in. A new address also needs a name: the first
   * try answers needsName (only once the code is right) and keeps the code for
   * the second try, which creates the account.
   */
  r.post("/auth/code/verify", limiter, async (req, res) => {
    const setup = opts.email;
    if (!setup) throw new HttpError(404, "NOT_AVAILABLE", "Signing in by email is not set up on this store.");
    const body = parse(z.object({ email, code, name: name.optional() }), req.body);
    const now = new Date();
    const row = await LoginCodeModel.findOne({ email: body.email, codeHash: { $type: "string" }, codeExpiresAt: { $gt: now } });
    if (!row) throw new HttpError(400, "CODE_EXPIRED", "This code has expired. Ask for a new one.");

    const given = Buffer.from(hashCode(body.email, body.code), "hex");
    const kept = Buffer.from(row.codeHash!, "hex");
    if (given.length !== kept.length || !timingSafeEqual(given, kept)) {
      // one write decides the try, so parallel guesses cannot each get a "first" wrong try
      const after = await LoginCodeModel.findOneAndUpdate(
        { _id: row._id, codeHash: row.codeHash },
        { $inc: { wrongTries: 1 } },
        { returnDocument: "after" },
      );
      if (!after || after.wrongTries >= WRONG_CODES) {
        await LoginCodeModel.updateOne({ _id: row._id }, { $set: { codeHash: null, codeExpiresAt: null } });
        throw new HttpError(400, "CODE_EXPIRED", "Too many wrong tries. Ask for a new code.");
      }
      throw new HttpError(400, "WRONG_CODE", `That code is not right. ${WRONG_CODES - after.wrongTries} tries left.`);
    }

    let user = await UserModel.findOne({ email: body.email });
    if (!user && !body.name) {
      res.json({ needsName: true });
      return;
    }
    // the code is used up the moment it signs someone in
    const used = await LoginCodeModel.updateOne({ _id: row._id, codeHash: row.codeHash }, { $set: { codeHash: null, codeExpiresAt: null } });
    if (used.modifiedCount !== 1) throw new HttpError(400, "CODE_EXPIRED", "This code was already used. Ask for a new one.");

    let created = false;
    if (!user) {
      try {
        user = await UserModel.create({ name: body.name, email: body.email, emailVerifiedAt: now });
        created = true;
      } catch {
        user = await UserModel.findOne({ email: body.email }); // created a moment ago by a parallel try
      }
      if (!user) throw new HttpError(500, "ERROR", "Something went wrong. Please try again.");
    } else if (!user.emailVerifiedAt) {
      user.emailVerifiedAt = now;
      await user.save();
    }
    await LoginThrottleModel.deleteOne({ email: body.email });
    if (created) sendLater(setup.mailer, welcomeMail(user, setup.siteUrl), "welcome");
    await signedIn(res, user);
    res.status(created ? 201 : 200).json({ user: publicUser(user) });
  });

  // ---------------------------------------------------------------- password

  r.post("/auth/login", limiter, async (req, res) => {
    const body = parse(z.object({ email, password: z.string().min(1, "Enter your password").max(200) }), req.body);
    const now = new Date();
    const throttle = await LoginThrottleModel.findOne({ email: body.email, lockedUntil: { $gt: now } });
    if (throttle) {
      const minutes = Math.ceil((throttle.lockedUntil!.getTime() - now.getTime()) / MINUTE);
      throw new HttpError(
        429,
        "TOO_MANY_TRIES",
        `Too many wrong passwords for this email. Sign in with an email code, or try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      );
    }
    const user = await UserModel.findOne({ email: body.email });
    const ok = user?.passwordHash ? await verifyPassword(user.passwordHash, body.password) : await dummyVerify(body.password);
    if (!user || !ok) {
      const after = await LoginThrottleModel.findOneAndUpdate(
        { email: body.email },
        { $inc: { failures: 1 }, $set: { purgeAt: new Date(now.getTime() + 60 * MINUTE) } },
        { upsert: true, returnDocument: "after" },
      );
      if (after.failures >= WRONG_PASSWORDS) {
        await LoginThrottleModel.updateOne(
          { _id: after._id },
          { $set: { failures: 0, lockedUntil: new Date(now.getTime() + COOL_DOWN_MINUTES * MINUTE) } },
        );
      }
      throw new HttpError(401, "WRONG_DETAILS", "Email or password is not correct.");
    }
    await LoginThrottleModel.deleteOne({ email: body.email });
    await signedIn(res, user);
    res.json({ user: publicUser(user) });
  });

  // ---------------------------------------------------------------- Google

  const google = opts.google;
  const googleKeys = google ? (google.keys ?? createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"))) : null;
  const flowKey = createHash("sha256").update(`bunty-google-flow:${opts.sessionSecret}`).digest();
  const FLOW_COOKIE = "bunty_google";
  // Lax, not Strict: the way back from Google is a top-level visit from another site
  const flowCookie = { httpOnly: true, sameSite: "lax" as const, path: "/api/auth/google" };

  /** Sends the browser to Google. The state, nonce and PKCE verifier wait in a signed cookie for the way back. */
  r.get("/auth/google", limiter, async (req, res) => {
    if (!google) throw new HttpError(404, "NOT_AVAILABLE", "Signing in with Google is not set up on this store.");
    const state = randomBytes(24).toString("base64url");
    const nonce = randomBytes(24).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const flow = await new SignJWT({ state, nonce, verifier, next: safeNext(req.query.next) })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("10m")
      .sign(flowKey);
    res.cookie(FLOW_COOKIE, flow, { ...flowCookie, secure: req.secure, maxAge: 10 * MINUTE });
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: google.clientId,
      redirect_uri: `${google.siteUrl}/api/auth/google/callback`,
      response_type: "code",
      scope: "openid email profile",
      state,
      nonce,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      prompt: "select_account",
    }).toString();
    res.redirect(302, url.toString());
  });

  /** Google sends the browser back here. Any problem lands on the sign-in page with a plain message. */
  r.get("/auth/google/callback", limiter, async (req, res) => {
    if (!google || !googleKeys) throw new HttpError(404, "NOT_AVAILABLE", "Signing in with Google is not set up on this store.");
    const fail = (why: string) => res.redirect(302, `/signin?error=${why}`);
    const cookie = req.headers.cookie?.split(";").map((p) => p.trim()).find((p) => p.startsWith(`${FLOW_COOKIE}=`));
    res.clearCookie(FLOW_COOKIE, flowCookie);
    if (typeof req.query.error === "string") return fail("google_cancelled");
    if (!cookie || typeof req.query.code !== "string" || typeof req.query.state !== "string") return fail("google");

    let flow: { state: string; nonce: string; verifier: string; next: string };
    try {
      const { payload } = await jwtVerify(decodeURIComponent(cookie.slice(FLOW_COOKIE.length + 1)), flowKey, { algorithms: ["HS256"] });
      flow = payload as unknown as typeof flow;
    } catch {
      return fail("google");
    }
    if (flow.state !== req.query.state) return fail("google");

    let profile: { sub: string; email: string; name: string };
    try {
      const tokenRes = await (google.fetch ?? fetch)("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: req.query.code,
          client_id: google.clientId,
          client_secret: google.clientSecret,
          redirect_uri: `${google.siteUrl}/api/auth/google/callback`,
          grant_type: "authorization_code",
          code_verifier: flow.verifier,
        }).toString(),
        signal: AbortSignal.timeout(8000),
      });
      if (!tokenRes.ok) return fail("google");
      const { id_token: idToken } = (await tokenRes.json()) as { id_token?: string };
      if (!idToken) return fail("google");
      const { payload } = await jwtVerify(idToken, googleKeys, {
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        audience: google.clientId,
      });
      if (payload.nonce !== flow.nonce || typeof payload.sub !== "string" || typeof payload.email !== "string") return fail("google");
      // only an address Google has checked may sign in to (or join) a Bunty account
      if (payload.email_verified !== true) return fail("google_unverified");
      const address = payload.email.toLowerCase();
      profile = { sub: payload.sub, email: address, name: typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : address.split("@")[0]! };
    } catch {
      return fail("google");
    }

    const now = new Date();
    let created = false;
    let user = await UserModel.findOne({ googleId: profile.sub });
    if (!user) {
      user = await UserModel.findOne({ email: profile.email });
      if (user) {
        if (user.googleId && user.googleId !== profile.sub) return fail("google");
        user.googleId = profile.sub;
        user.emailVerifiedAt ??= now;
        await user.save();
      } else {
        user = await UserModel.create({ name: profile.name.slice(0, 100), email: profile.email, googleId: profile.sub, emailVerifiedAt: now });
        created = true;
      }
    }
    await LoginThrottleModel.deleteOne({ email: user.email });
    if (created && opts.email) sendLater(opts.email.mailer, welcomeMail(user, opts.email.siteUrl), "welcome");
    await signedIn(res, user);
    res.redirect(302, flow.next);
  });

  // ---------------------------------------------------------------- account security

  /** Adds a password, or changes it (the current one is needed then). Signs out every other device. */
  r.post("/auth/password", requireUser, limiter, async (req, res) => {
    const body = parse(z.object({ current: z.string().max(200).optional(), password }), req.body);
    const user = await UserModel.findById(req.user!.id);
    if (!user) throw new HttpError(401, "SIGN_IN_REQUIRED", "Please sign in to continue.");
    const had = Boolean(user.passwordHash);
    if (had && !(body.current && (await verifyPassword(user.passwordHash!, body.current)))) {
      throw new HttpError(400, "WRONG_PASSWORD", "Your current password is not correct.");
    }
    checkNewPassword(body.password, user.email);
    const updated = await UserModel.findOneAndUpdate(
      { _id: user._id },
      { $set: { passwordHash: await hashPassword(body.password) }, $inc: { sessionVersion: 1 } },
      { returnDocument: "after" },
    );
    if (!updated) throw new HttpError(401, "SIGN_IN_REQUIRED", "Please sign in to continue.");
    if (opts.email) {
      sendLater(opts.email.mailer, (had ? passwordChangedMail : passwordAddedMail)(updated, opts.email.siteUrl), "password changed");
    }
    await signedIn(res, updated);
    res.json({ user: publicUser(updated) });
  });

  /** Ends every other session; this device stays signed in. */
  r.post("/auth/sign-out-everywhere", requireUser, async (req, res) => {
    const updated = await UserModel.findOneAndUpdate({ _id: req.user!.id }, { $inc: { sessionVersion: 1 } }, { returnDocument: "after" });
    if (!updated) throw new HttpError(401, "SIGN_IN_REQUIRED", "Please sign in to continue.");
    await signedIn(res, updated);
    res.json({ ok: true });
  });

  return r;
}
