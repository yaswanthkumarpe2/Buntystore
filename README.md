# Bunty Store

A demo online store: people sign up, shop six categories, place orders, track them, cancel them and return them.
It exists to show how [Serviqo](https://serviqo.live) handles customer support for a real business. Payments and
deliveries are simulated: nothing is charged and nothing is shipped.

## What it does

- **Accounts** — sign in or sign up with a 6-digit code by email (no password needed), or "Continue with Google"
  (off until `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set). Every new account proves its email first. A
  password is optional (argon2 hashes; easy ones are turned down). Codes and passwords are limited per address, and no
  answer says whether an account exists. The session is an http-only cookie; Your account shows the ways to sign in,
  adds or changes the password and signs out every other device. Forgot password: a one-time link by email, 30 minutes.
- **Emails** — a welcome email for a new account; sign-in codes; and the customer hears when an order is placed,
  shipped, out for delivery, delivered or cancelled, and at each step of a return. Every email says it comes from a
  demo store. Sent through Resend; off until `RESEND_API_KEY` is set.
- **Shop** — 60 products in Electronics, Fashion, Home & Kitchen, Books, Beauty and Grocery; search, sort, product pages.
- **Cart and checkout** — delivery address, pay on delivery, free delivery from ₹499 (₹40 below).
- **Orders** — every order has a number like `BS-7K2M9XQ4` and a timeline: Placed → Packed → Shipped → Out for delivery → Delivered.
- **Cancel** — while an order is Placed or Packed. Nothing was charged, so nothing is refunded.
- **Return** — within 7 days of delivery (grocery cannot be returned). Requested → Approved → Picked up → Refunded.
- **Store team page** (`/admin`) — move orders and returns to their next step, or decline a return with a note.

The rules live in one file, `server/src/policy.ts`. Every status change is a single conditional database write, so two
clicks at the same moment cannot both apply.

## Project layout

```
server/   Express 5 + MongoDB (Mongoose) API; serves the built web app in production
web/      React 19 + Vite + Tailwind CSS v4
```

## Run it locally

Node 22 or newer.

```bash
npm install
```

**Quick preview (no database needed):** an in-memory database with the catalogue, a store-team account and demo
customers with orders in every state. It prints the password to use.

```bash
cd server && npx tsx scripts/preview.ts
```

Then, in a second terminal:

```bash
npm run dev:web
```

Open http://localhost:5180. After `npm run build`, http://localhost:4000 also serves the built site with the same
security policy as production. Pass `SERVIQO_URL` and `SERVIQO_WIDGET_KEY` to the preview to see the chat, and
`PREVIEW_EMAILS=1` to print every email (reset links too) in the preview's terminal instead of sending it.

**With your own MongoDB:** copy `.env.example` to `.env`, fill it in, then `npm run seed` and `npm run dev:server`.

## Checks

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

## Deploy

**Live setup:** Bunty runs on the AWS instance it shares with Serviqo, behind the same Cloudflare Tunnel (Serviqo's
ADR-061). A push to `main` runs CI (`.github/workflows/ci.yml`); when it passes, `deploy.yml` builds the release,
uploads it and switches the server over, rolling back if `/health` fails. AWS access is by OpenID Connect: no AWS key
or other secret is stored in this repository. Settings live in AWS Parameter Store; fill `.env.production` (never
committed) and run `npm run aws:settings -- --dry-run`, then `npm run aws:settings`, to check and upload them without
printing them.

**Any other Node 22 host:** build command `npm install && npm run build`, start command `npm start`, health check
`/health`. Set these variables on the host:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `MONGODB_URI` | a MongoDB connection string (its own database, not Serviqo's) |
| `SESSION_SECRET` | 32+ random characters |
| `SERVIQO_CONNECTOR_SECRET` | optional: 32+ random characters, the same value entered in Serviqo's connector settings |
| `SERVIQO_IDENTITY_SECRET` | optional: 32+ random characters, a different value, also entered in Serviqo |
| `SERVIQO_URL` | optional: `https://serviqo.live`, where the chat comes from (not a secret) |
| `SERVIQO_WIDGET_KEY` | optional: Bunty's widget key from Serviqo, starting `wk_` (not a secret: every page with the chat shows it) |
| `RESEND_API_KEY` | optional: a Resend API key (`re_…`) allowed to send from your domain; turns email on |
| `EMAIL_FROM` | with the key: the sender, e.g. `Bunty Store <orders@bunty.me>`, on a domain verified in Resend |
| `PUBLIC_URL` | with the key: this site's address, e.g. `https://bunty.me`, for links in emails |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | optional: a Google OAuth client (Web application) whose redirect URI is `{PUBLIC_URL}/api/auth/google/callback`; turns on "Continue with Google" |

The catalogue is added automatically on first start. To create the store-team account and demo customers, run
`npm run seed` once with `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` and `SEED_DEMO_PASSWORD` set.

## Serviqo inside Bunty Store

**Built:** the connector Serviqo's AI uses to answer a signed-in customer about their own orders and, after the
customer taps Confirm in the chat, cancel an order or start a return. Every request must be signed; responses never
include an address or a phone number; Bunty's own rules decide every action. How it works:
[docs/serviqo-connector.md](docs/serviqo-connector.md). It is off until `SERVIQO_CONNECTOR_SECRET` is set.

**Built:** the Serviqo chat on every page, once `SERVIQO_URL` and `SERVIQO_WIDGET_KEY` are set. The page loads
Serviqo's `widget.js` with Bunty's key, and the security policy opens only to that address (its script, its API and
live updates, and logos). In Serviqo, Bunty's website address must be on the widget's allowed list.

**Coming next:**

1. Serviqo's side: the signed-in customer's identity in the chat, the assistant reading their orders, and the
   confirmation cards.
2. A Customers space in Serviqo where the support team can look up a Bunty customer and their orders.
