import { existsSync } from "node:fs";
import path from "node:path";

import express from "express";
import helmet from "helmet";

import { createSessions } from "./auth";
import { orderNotifier, type EmailSetup } from "./emails";
import { errorHandler } from "./errors";
import { apiRouter } from "./routes";
import { serviqoRouter, type ServiqoChat } from "./serviqo";

export interface AppOptions {
  sessionSecret: string;
  production: boolean;
  /** Sign-in and sign-up tries per 15 minutes per address. */
  authLimit?: number;
  /** The built web app, served in production. */
  webDist?: string;
  /** Serviqo's connector and identity secrets and its chat; each part is off until it is set. */
  serviqo?: { connectorSecret?: string; identitySecret?: string; chat?: ServiqoChat };
  /** Email for order updates and password reset; off when unset. */
  email?: EmailSetup;
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
    sessions.read,
    apiRouter(sessions, {
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
