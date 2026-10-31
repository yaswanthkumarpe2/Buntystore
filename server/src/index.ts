import path from "node:path";

import mongoose from "mongoose";

import { createApp } from "./app";
import { loadEnv } from "./env";
import { resendMailer } from "./mail";
import { ensureCatalog } from "./seed/catalogSeed";

async function main() {
  const env = loadEnv();
  await mongoose.connect(env.MONGODB_URI);
  const added = await ensureCatalog();
  if (added > 0) console.log(`Added ${added} products to the catalogue`);

  const app = createApp({
    sessionSecret: env.SESSION_SECRET,
    production: env.NODE_ENV === "production",
    webDist: path.resolve(__dirname, "../../web/dist"),
    serviqo: {
      connectorSecret: env.SERVIQO_CONNECTOR_SECRET,
      identitySecret: env.SERVIQO_IDENTITY_SECRET,
      chat:
        env.SERVIQO_URL && env.SERVIQO_WIDGET_KEY ? { origin: env.SERVIQO_URL, widgetKey: env.SERVIQO_WIDGET_KEY } : undefined,
    },
    email:
      env.RESEND_API_KEY && env.EMAIL_FROM && env.PUBLIC_URL
        ? { mailer: resendMailer({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM }), siteUrl: env.PUBLIC_URL }
        : undefined,
    google:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.PUBLIC_URL
        ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, siteUrl: env.PUBLIC_URL }
        : undefined,
    publicUrl: env.PUBLIC_URL,
  });
  app.listen(env.PORT, () =>
    console.log(
      `Bunty Store listening on :${env.PORT} (email ${env.RESEND_API_KEY ? "on" : "off"}, Google sign-in ${env.GOOGLE_CLIENT_ID ? "on" : "off"})`,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
