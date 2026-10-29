import "dotenv/config";

import { z } from "zod";

/** An optional secret: empty (as copied from .env.example) means unset. */
const optionalSecret = (name: string) =>
  z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().min(32, `${name} must be at least 32 characters`).optional(),
  );

/** Every setting the server reads, checked once at start-up. */
const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(4000),
    MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
    SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
    /** Signs Serviqo's requests to /api/serviqo (Serviqo ADR-060). Unset: the connector is off. */
    SERVIQO_CONNECTOR_SECRET: optionalSecret("SERVIQO_CONNECTOR_SECRET"),
    /** Signs the pass that tells Serviqo which customer is chatting. Unset: no pass is issued. */
    SERVIQO_IDENTITY_SECRET: optionalSecret("SERVIQO_IDENTITY_SECRET"),
  })
  .refine((e) => !e.SERVIQO_CONNECTOR_SECRET || e.SERVIQO_CONNECTOR_SECRET !== e.SERVIQO_IDENTITY_SECRET, {
    path: ["SERVIQO_IDENTITY_SECRET"],
    message: "must be different from SERVIQO_CONNECTOR_SECRET",
  });

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${problems}`);
  }
  return parsed.data;
}
