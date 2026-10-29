import argon2 from "argon2";
import { SignJWT, jwtVerify } from "jose";
import type { NextFunction, Request, Response } from "express";

import { HttpError } from "./errors";
import { UserModel } from "./models";

export const SESSION_COOKIE = "bunty_session";
const SESSION_DAYS = 7;

export interface SessionUser {
  id: string;
  role: "customer" | "admin";
}

declare module "express-serve-static-core" {
  interface Request {
    user?: SessionUser;
  }
}

export const hashPassword = (password: string) => argon2.hash(password, { type: argon2.argon2id });

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/** A dummy hash, verified when the email is unknown, so timing does not reveal which emails exist. */
let dummyHash: Promise<string> | null = null;
export function dummyVerify(password: string): Promise<boolean> {
  dummyHash ??= hashPassword("not-a-real-password-for-timing-only");
  return dummyHash.then((h) => verifyPassword(h, password)).then(() => false);
}

export function createSessions(secret: string, secure: boolean) {
  const key = new TextEncoder().encode(secret);

  /** `version` is the account's sessionVersion: when it changes, this session stops working. */
  async function issue(res: Response, user: SessionUser, version: number): Promise<void> {
    const token = await new SignJWT({ role: user.role, v: version })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime(`${SESSION_DAYS}d`)
      .sign(key);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
      path: "/",
    });
  }

  function clear(res: Response): void {
    res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: "lax", secure, path: "/" });
  }

  /**
   * Reads the session if there is one; never rejects the request. The account is
   * looked up each time, so a reset password or a changed role applies at once.
   */
  async function read(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (token) {
      try {
        const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
        if (typeof payload.sub === "string" && /^[a-f0-9]{24}$/.test(payload.sub)) {
          const user = await UserModel.findById(payload.sub, { role: 1, sessionVersion: 1 }).lean();
          const version = typeof payload.v === "number" ? payload.v : 0;
          if (user && version === (user.sessionVersion ?? 0)) {
            req.user = { id: payload.sub, role: user.role === "admin" ? "admin" : "customer" };
          }
        }
      } catch {
        // expired or tampered: treated as signed out
      }
    }
    next();
  }

  return { issue, clear, read };
}

export function requireUser(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(new HttpError(401, "SIGN_IN_REQUIRED", "Please sign in to continue."));
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(new HttpError(401, "SIGN_IN_REQUIRED", "Please sign in to continue."));
  if (req.user.role !== "admin") return next(new HttpError(403, "ADMIN_ONLY", "Only the store team can do this."));
  next();
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
