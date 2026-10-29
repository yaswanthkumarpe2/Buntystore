# Bunty Store

A demo online store: people sign up, shop six categories, place orders, track them, cancel them and return them.
It exists to show how [Serviqo](https://serviqo.live) handles customer support for a real business. Payments and
deliveries are simulated: nothing is charged and nothing is shipped.

## What it does

- **Accounts** — sign up and sign in with email and password (argon2 hashes, an http-only session cookie, rate-limited).
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

Open http://localhost:5180.

**With your own MongoDB:** copy `.env.example` to `.env`, fill it in, then `npm run seed` and `npm run dev:server`.

## Checks

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

## Deploy

One service on any Node 22 host. Build command `npm install && npm run build`, start command `npm start`, health check
`/health`. Set these variables on the host:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `MONGODB_URI` | a MongoDB connection string (its own database, not Serviqo's) |
| `SESSION_SECRET` | 32+ random characters |
| `SERVIQO_CONNECTOR_SECRET` | optional: 32+ random characters, the same value entered in Serviqo's connector settings |
| `SERVIQO_IDENTITY_SECRET` | optional: 32+ random characters, a different value, also entered in Serviqo |

The catalogue is added automatically on first start. To create the store-team account and demo customers, run
`npm run seed` once with `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` and `SEED_DEMO_PASSWORD` set.

## Serviqo inside Bunty Store

**Built:** the connector Serviqo's AI uses to answer a signed-in customer about their own orders and, after the
customer taps Confirm in the chat, cancel an order or start a return. Every request must be signed; responses never
include an address or a phone number; Bunty's own rules decide every action. How it works:
[docs/serviqo-connector.md](docs/serviqo-connector.md). It is off until `SERVIQO_CONNECTOR_SECRET` is set.

**Coming next:**

1. Serviqo's side: connector settings, the signed-in customer's identity in the chat, and the confirmation cards.
2. A Customers space in Serviqo where the support team can look up a Bunty customer and their orders.
3. The Serviqo chat widget on every page, behind a small round AI button.
