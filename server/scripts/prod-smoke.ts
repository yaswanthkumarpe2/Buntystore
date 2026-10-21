/**
 * Starts the BUILT server (server/dist) in production mode on an in-memory database at :4100,
 * for checking the built site in a browser. `npm run build` first.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";

import { MongoMemoryServer } from "mongodb-memory-server";

async function main() {
  const mongo = await MongoMemoryServer.create();
  const child = spawn(process.execPath, [path.resolve(__dirname, "../dist/index.js")], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: "4100",
      MONGODB_URI: mongo.getUri("bunty-smoke"),
      SESSION_SECRET: randomBytes(32).toString("hex"),
    },
    stdio: "inherit",
  });
  const stop = async () => {
    child.kill();
    await mongo.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

void main();
