import { existsSync } from "node:fs";
import path from "node:path";

import express from "express";
import helmet from "helmet";

import { createSessions } from "./auth";
import { errorHandler } from "./errors";
import { apiRouter } from "./routes";
import { serviqoRouter } from "./serviqo";

export interface AppOptions {
  sessionSecret: string;
  production: boolean;
  /** Sign-in and sign-up tries per 15 minutes per address. */
  authLimit?: number;
  /** The built web app, served in production. */
  webDist?: string;
  /** Serviqo's connector and identity secrets; each part is off until its secret is set. */
  serviqo?: { connectorSecret?: string; identitySecret?: string };
}

export function createApp(opts: AppOptions) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "img-src": ["'self'", "data:"],
          "connect-src": ["'self'"],
        },
      },
    }),
  );
  // Before the JSON parser: the connector checks a signature over the raw body.
  app.use("/api/serviqo", serviqoRouter({ connectorSecret: opts.serviqo?.connectorSecret }));
  app.use(express.json({ limit: "50kb" }));

  const sessions = createSessions(opts.sessionSecret, opts.production);
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use(
    "/api",
    sessions.read,
    apiRouter(sessions, { authLimit: opts.authLimit ?? 20, identitySecret: opts.serviqo?.identitySecret }),
  );

  if (opts.webDist && existsSync(opts.webDist)) {
    app.use(express.static(opts.webDist, { index: false, maxAge: "1h" }));
    // every other path is a page of the single-page app
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(opts.webDist!, "index.html")));
  }

  app.use(errorHandler);
  return app;
}
