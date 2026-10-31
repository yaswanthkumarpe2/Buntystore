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

/** A site's address: a bare origin, https except on this computer. */
const siteOrigin = (name: string, example: string) =>
  z.preprocess(
    blankIsUnset,
    z
      .string()
      .url(`${name} must be an address like ${example}`)
      .transform((v) => new URL(v))
      .refine((u) => u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname)), {
        message: `${name} must start with https://`,
      })
      .refine((u) => (u.pathname === "/" || u.pathname === "") && !u.search && !u.hash && !u.username, {
        message: `${name} must be just the address, like ${example} (no path)`,
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
    SERVIQO_URL: siteOrigin("SERVIQO_URL", "https://serviqo.live"),
    /** Bunty's widget key from Serviqo (public: every page that shows the chat contains it). */
    SERVIQO_WIDGET_KEY: z.preprocess(
      blankIsUnset,
      z
        .string()
        .regex(/^wk_[A-Za-z0-9_-]{20,100}$/, "SERVIQO_WIDGET_KEY must be the key Serviqo shows, starting with wk_")
        .optional(),
    ),
    /** Sends order updates and password reset links through Resend. Unset: no email is sent. */
    RESEND_API_KEY: z.preprocess(
      blankIsUnset,
      z.string().regex(/^re_[A-Za-z0-9_-]{10,200}$/, "RESEND_API_KEY must be a Resend API key, starting with re_").optional(),
    ),
    /** Who the emails come from, on a domain verified in Resend, e.g. Bunty Store <orders@bunty.me>. */
    EMAIL_FROM: z.preprocess(
      blankIsUnset,
      z
        .string()
        .max(200)
        .regex(/^([^<>@\r\n]+ <[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>|[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)$/, {
          message: "EMAIL_FROM must be like Bunty Store <orders@bunty.me>",
        })
        .optional(),
    ),
    /** The site's own address, for links in emails, e.g. https://bunty.me. */
    PUBLIC_URL: siteOrigin("PUBLIC_URL", "https://bunty.me"),
    /** "Continue with Google": the OAuth client's ID and secret from Google Cloud. Unset: no Google button. */
    GOOGLE_CLIENT_ID: z.preprocess(
      blankIsUnset,
      z
        .string()
        .regex(/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/, "GOOGLE_CLIENT_ID must look like 1234-abc.apps.googleusercontent.com")
        .optional(),
    ),
    GOOGLE_CLIENT_SECRET: z.preprocess(blankIsUnset, z.string().min(10, "GOOGLE_CLIENT_SECRET looks too short").max(200).optional()),
  })
  .refine((e) => !e.RESEND_API_KEY || e.EMAIL_FROM, { path: ["EMAIL_FROM"], message: "is needed with RESEND_API_KEY" })
  .refine((e) => !e.RESEND_API_KEY || e.PUBLIC_URL, { path: ["PUBLIC_URL"], message: "is needed with RESEND_API_KEY" })
  .refine((e) => !e.GOOGLE_CLIENT_ID === !e.GOOGLE_CLIENT_SECRET, {
    path: ["GOOGLE_CLIENT_SECRET"],
    message: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET go together",
  })
  .refine((e) => !e.GOOGLE_CLIENT_ID || e.PUBLIC_URL, { path: ["PUBLIC_URL"], message: "is needed with GOOGLE_CLIENT_ID" })
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
