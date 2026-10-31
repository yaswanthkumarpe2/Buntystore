/**
 * Copies Bunty Store's production settings from a local env file into AWS SSM
 * Parameter Store, where the server on AWS reads them (Serviqo's ADR-061):
 *   /bunty/prod/<NAME>   what the store runs with
 *   /bunty/seed/<NAME>   only for the one-off seed (store-team and demo passwords)
 *
 *   npm run aws:settings -- --dry-run     check the file, upload nothing
 *   npm run aws:settings                  check, then upload (SecureString, replacing old values)
 *
 * Options: --file <path> (default .env.production), --profile <aws profile>
 * (default serviqo), --region <region> (default ap-south-2).
 * Values are checked with the server's own rules first and are never printed;
 * each one reaches the AWS CLI through a private temporary file, not the command line.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parse } from "dotenv";

import { loadEnv } from "../server/src/env";

const STORE = [
  "MONGODB_URI",
  "SESSION_SECRET",
  "SERVIQO_CONNECTOR_SECRET",
  "SERVIQO_IDENTITY_SECRET",
  "SERVIQO_URL",
  "SERVIQO_WIDGET_KEY",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "PUBLIC_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
] as const;
const SEED = ["SEED_ADMIN_EMAIL", "SEED_ADMIN_PASSWORD", "SEED_DEMO_PASSWORD"] as const;

function option(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const dryRun = process.argv.includes("--dry-run");
const file = path.resolve(option("file", ".env.production"));
const profile = option("profile", "serviqo");
const region = option("region", "ap-south-2");

const raw = parse(readFileSync(file, "utf8"));
// an older name for the sender, kept working
if (!raw.EMAIL_FROM && raw.MAIL_FROM) raw.EMAIL_FROM = raw.MAIL_FROM;
const value = (k: string) => (raw[k] ?? "").trim();

// The server's own start-up check, on exactly what will be uploaded.
try {
  loadEnv({ NODE_ENV: "production", ...Object.fromEntries(STORE.map((k) => [k, value(k)])) });
} catch (e) {
  console.error(`Not uploaded: ${(e as Error).message}`);
  console.error(`Fix ${path.basename(file)} and run this again.`);
  process.exit(1);
}
const seedProblems = SEED.filter((k) => value(k) && k !== "SEED_ADMIN_EMAIL" && value(k).length < 8);
if (seedProblems.length > 0) {
  console.error(`Not uploaded: ${seedProblems.join(", ")} must be at least 8 characters.`);
  process.exit(1);
}

const uploads = [
  ...STORE.map((k) => ({ name: `/bunty/prod/${k}`, key: k })),
  ...SEED.map((k) => ({ name: `/bunty/seed/${k}`, key: k })),
].filter((u) => value(u.key) !== "");
const skipped = [...STORE, ...SEED].filter((k) => value(k) === "");

console.log(`${dryRun ? "Would set" : "Setting"} ${uploads.length} parameters in ${region} (profile ${profile}):`);
const dir = mkdtempSync(path.join(tmpdir(), "bunty-settings-"));
try {
  for (const u of uploads) {
    if (!dryRun) {
      const input = path.join(dir, "input.json");
      writeFileSync(input, JSON.stringify({ Name: u.name, Value: value(u.key), Type: "SecureString", Overwrite: true }), {
        mode: 0o600,
      });
      execFileSync("aws", ["ssm", "put-parameter", "--cli-input-json", `file://${input}`, "--profile", profile, "--region", region], {
        stdio: ["ignore", "ignore", "inherit"],
      });
      rmSync(input);
    }
    console.log(`  ${u.name}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
if (skipped.length > 0) console.log(`Empty in ${path.basename(file)}, left as they are on AWS: ${skipped.join(", ")}`);
if (!dryRun) console.log("Done. Restart Bunty on the server (or deploy) for the new values to apply.");
