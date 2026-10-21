import path from "node:path";

import mongoose from "mongoose";

import { createApp } from "./app";
import { loadEnv } from "./env";
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
  });
  app.listen(env.PORT, () => console.log(`Bunty Store listening on :${env.PORT}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
