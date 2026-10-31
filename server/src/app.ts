import { existsSync } from "node:fs";
import path from "node:path";

import express from "express";
import helmet from "helmet";

import { createSessions } from "./auth";
import { orderNotifier, type EmailSetup } from "./emails";
import { errorHandler } from "./errors";
import { apiRouter } from "./routes";
import { serviqoRouter, type ServiqoChat } from "./serviqo";
import type { GoogleSetup } from "./signin";

export interface AppOptions {
  sessionSecret: string;
  production: boolean;
  /** Sign-in and sign-up tries per 15 minutes per address. */
  authLimit?: number;
  /** The built web app, served in production. */
  webDist?: string;
  /** Serviqo's connector and identity secrets and its chat; each part is off until it is set. */
  serviqo?: { connectorSecret?: string; identitySecret?: string; chat?: ServiqoChat };
  /** Email for order updates, sign-in codes and password reset; off when unset. */
  email?: EmailSetup;
  /** "Continue with Google"; off when unset. */
  google?: GoogleSetup;
  /** The site's own address (e.g. https://bunty.me): changes may only come from pages on it. */
  publicUrl?: string;
}

/**
 * A second guard next to the SameSite cookie: a browser always says which site
 * a request comes from, and a change (anything but GET) from another site is
 * turned away. Requests without an Origin (not from a browser) pass.
 */
function sameSiteOnly(publicUrl: string | undefined, production: boolean): express.RequestHandler {
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS" || !origin) return next();
    const local = !production && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const self = origin === publicUrl || origin === `${req.protocol}://${req.get("host")}`;
    if (local || self) return next();
    res.status(403).json({ error: { code: "WRONG_SITE", message: "This request did not come from Bunty Store." } });
  };
}

/** The security policy opens only as far as the chat needs: its script, its API and live updates, and logos. */
function contentSecurity(chat: ServiqoChat | undefined): Record<string, string[]> {
  if (!chat) return { "script-src": ["'self'"], "img-src": ["'self'", "data:"], "connect-src": ["'self'"] };
  const live = chat.origin.replace(/^http/, "ws");
  return {
    "script-src": ["'self'", chat.origin],
    "img-src": ["'self'", "data:", chat.origin, "https://res.cloudinary.com"],
    "connect-src": ["'self'", chat.origin, live],
  };
}

export function createApp(opts: AppOptions) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: contentSecurity(opts.serviqo?.chat),
      },
    }),
  );
  const notify = orderNotifier(opts.email);
  // Before the JSON parser: the connector checks a signature over the raw body.
  app.use("/api/serviqo", serviqoRouter({ connectorSecret: opts.serviqo?.connectorSecret, notify }));
  app.use(express.json({ limit: "50kb" }));

  const sessions = createSessions(opts.sessionSecret, opts.production);
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use(
    "/api",
    sameSiteOnly(opts.publicUrl, opts.production),
    sessions.read,
    apiRouter(sessions, {
      sessionSecret: opts.sessionSecret,
      google: opts.google,
      authLimit: opts.authLimit ?? 20,
      identitySecret: opts.serviqo?.identitySecret,
      chat: opts.serviqo?.chat,
      email: opts.email,
      notify,
    }),
  );

  if (opts.webDist && existsSync(opts.webDist)) {
    app.use(express.static(opts.webDist, { index: false, maxAge: "1h" }));
    // every other path is a page of the single-page app
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(opts.webDist!, "index.html")));
  }

  app.use(errorHandler);
  return app;
}
