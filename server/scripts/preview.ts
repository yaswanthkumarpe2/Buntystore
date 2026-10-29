/**
 * Local preview: an in-memory MongoDB, the demo seed, and the API on :4000.
 * Never reads .env and never touches a real database. Start the web app with `npm run dev:web`.
 *   npx tsx scripts/preview.ts
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

import { createApp } from "../src/app";
import type { Mail } from "../src/mail";

async function main() {
  const mongo = await MongoMemoryServer.create();
  // a fresh password each run (or PREVIEW_PASSWORD), printed below: the repo holds none
  const password = process.env.PREVIEW_PASSWORD ?? randomBytes(9).toString("base64url");
  const env = {
    ...process.env,
    NODE_ENV: "development",
    PORT: "4000",
    MONGODB_URI: mongo.getUri("bunty-preview"),
    SESSION_SECRET: randomBytes(32).toString("hex"),
    SEED_ADMIN_EMAIL: "team@buntystore.test",
    SEED_ADMIN_PASSWORD: password,
    SEED_DEMO_PASSWORD: password,
  };
  Object.assign(process.env, env);
  const tsx = path.resolve(__dirname, "../../node_modules/.bin/tsx" + (process.platform === "win32" ? ".cmd" : ""));
  execFileSync(tsx, [path.resolve(__dirname, "../src/seed/run.ts")], { env, stdio: "inherit", shell: process.platform === "win32" });

  await mongoose.connect(env.MONGODB_URI);
  // the Serviqo connector and chat, when their settings are passed in (docs/serviqo-connector.md)
  const chat =
    process.env.SERVIQO_URL && process.env.SERVIQO_WIDGET_KEY
      ? { origin: process.env.SERVIQO_URL, widgetKey: process.env.SERVIQO_WIDGET_KEY }
      : undefined;
  const serviqo = {
    connectorSecret: process.env.SERVIQO_CONNECTOR_SECRET,
    identitySecret: process.env.SERVIQO_IDENTITY_SECRET,
    chat,
  };
  // PREVIEW_EMAILS=1 prints each email here instead of sending it (order updates, reset links)
  const email =
    process.env.PREVIEW_EMAILS === "1"
      ? {
          siteUrl: "http://localhost:4000",
          mailer: { on: true, send: async (m: Mail) => console.log(`\nEMAIL to ${m.to}: ${m.subject}\n${m.text}\n`) },
        }
      : undefined;
  // after `npm run build`, :4000 also serves the built site, with the same security policy as production
  const webDist = path.resolve(__dirname, "../../web/dist");
  createApp({ sessionSecret: env.SESSION_SECRET, production: false, authLimit: 1000, serviqo, webDist, email }).listen(4000, () =>
    console.log(`PREVIEW ready on :4000 (in-memory database). Sign in as team@buntystore.test or priya.sharma@example.com with: ${password}`),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
