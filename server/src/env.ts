import "dotenv/config";

import { z } from "zod";

/** Empty (as copied from .env.example) means unset. */
const blankIsUnset = (v: unknown) => (v === "" ? undefined : v);

/** An optional secret: empty means unset. */
const optionalSecret = (name: string) =>
  z.preprocess(
    blankIsUnset,
    z.string().min(32, `${name} must be at least 32 characters`).optional(),
  );

/** Serviqo's address: a bare origin, https except on this computer. */
const serviqoOrigin = z.preprocess(
  blankIsUnset,
  z
    .string()
    .url("SERVIQO_URL must be an address like https://serviqo.live")
    .transform((v) => new URL(v))
    .refine((u) => u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname)), {
      message: "SERVIQO_URL must start with https://",
    })
    .refine((u) => (u.pathname === "/" || u.pathname === "") && !u.search && !u.hash && !u.username, {
      message: "SERVIQO_URL must be just the address, like https://serviqo.live (no path)",
    })
    .transform((u) => u.origin)
    .optional(),
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
    /** Where the Serviqo chat comes from. With SERVIQO_WIDGET_KEY it puts the chat on every page. */
    SERVIQO_URL: serviqoOrigin,
    /** Bunty's widget key from Serviqo (public: every page that shows the chat contains it). */
    SERVIQO_WIDGET_KEY: z.preprocess(
      blankIsUnset,
      z
        .string()
        .regex(/^wk_[A-Za-z0-9_-]{20,100}$/, "SERVIQO_WIDGET_KEY must be the key Serviqo shows, starting with wk_")
        .optional(),
    ),
  })
  .refine((e) => !e.SERVIQO_WIDGET_KEY || e.SERVIQO_URL, {
    path: ["SERVIQO_URL"],
    message: "is needed with SERVIQO_WIDGET_KEY",
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
