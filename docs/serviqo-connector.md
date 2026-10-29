# The Serviqo connector

Serviqo's AI assistant answers Bunty Store customers about **their own orders** and, after the customer taps
**Confirm** in the chat, can cancel an order or start a return. This page is the contract between the two systems
(Serviqo's side is recorded in its ADR-060).

- **Live lookups only.** Serviqo asks Bunty each time it needs something; nothing is copied into Serviqo in bulk.
- **Only what the assistant needs.** Items, status, dates and amounts. Never an address, a phone number or text the
  customer typed.
- **Bunty's rules decide.** Cancelling and returning call the same code the website uses (`server/src/policy.ts`,
  `server/src/orders.ts`), so the assistant cannot do anything a customer could not do on the site.
- **Off by default.** Without `SERVIQO_CONNECTOR_SECRET` every `/api/serviqo/*` address answers 404; without
  `SERVIQO_IDENTITY_SECRET` no identity pass is issued.

## 1. Signed requests (Serviqo → Bunty)

Every request to `/api/serviqo/*` carries three headers:

| Header | Value |
|---|---|
| `X-Serviqo-Timestamp` | the current time in Unix **seconds** |
| `X-Serviqo-Nonce` | 16 to 64 random characters from `A-Z a-z 0-9 _ -`, new for every request |
| `X-Serviqo-Signature` | `v1=` followed by the lowercase hex HMAC-SHA256 of the text below, keyed with `SERVIQO_CONNECTOR_SECRET` |

The signed text is six lines joined with `\n` (no trailing newline):

```
v1
<METHOD in capitals>
<path with query string, exactly as sent, e.g. /api/serviqo/customers/64f.../orders?limit=5>
<timestamp>
<nonce>
<lowercase hex SHA-256 of the raw request body; of the empty string for a GET>
```

Bunty refuses (401) a request that is unsigned (`SIGNATURE_REQUIRED`), more than 5 minutes from its clock either way
(`STALE_REQUEST`), wrongly signed (`BAD_SIGNATURE`), or whose nonce was already used (`REPLAYED_REQUEST`). Nonces are
kept for 10 minutes. Signatures are compared in constant time, and only a correctly signed request uses up a nonce.

The reference implementation is `signRequest()` in `server/src/serviqo.ts`.

## 2. Reading

`:customerId` is the Bunty user id that Serviqo learned from the customer's identity pass (section 4).

| Request | Answer |
|---|---|
| `GET /api/serviqo/policy` | the store's rules: return window, delivery fees, the allowed cancel and return reasons, and the rules as plain sentences |
| `GET /api/serviqo/customers/:customerId` | `customer`: id, name, email, member since, order count, open orders, open returns |
| `GET /api/serviqo/customers/:customerId/orders?limit=5` | `orders`: the newest first, 1 to 20 (default 5) |
| `GET /api/serviqo/customers/:customerId/orders/:number` | `order`: one order, only if it belongs to that customer (otherwise 404) |

Each order has its number, status and label, items (name, quantity, price, returnable), amounts, payment method,
expected and actual delivery dates, timeline, cancellation, return and refund status, and:

- `canCancel` and `cancelBlockedReason`
- `canReturn`, `returnBlockedReason` and `returnDeadline`

The reasons are the same plain sentences the website shows, so the assistant can repeat them as they are.

## 3. Acting, once

| Request | Body |
|---|---|
| `POST /api/serviqo/customers/:customerId/orders/:number/cancel` | `{ "reason": <one of the policy's cancelReasons> }` |
| `POST /api/serviqo/customers/:customerId/orders/:number/return` | `{ "reason": <one of the policy's returnReasons> }` |

Both need an `Idempotency-Key` header (8 to 100 characters from `A-Z a-z 0-9 _ -`). Serviqo sends one key per
confirmation card, so:

- a retry with the same key gets the **first answer back** (success or refusal) and nothing happens twice;
- two copies racing each other cannot both act (the second gets the first answer or `409 IN_PROGRESS`);
- the same key for a different order or action is refused (`422 IDEMPOTENCY_KEY_REUSED`).

Keys are kept for 24 hours. A refusal by the store's rules is an ordinary answer, for example
`409 CANNOT_CANCEL` with the sentence to show the customer. A return started by the assistant covers the whole order,
like one started on the website, and carries no free-text details.

## 4. Who is chatting (Bunty → the customer's browser → Serviqo)

`GET /api/me/serviqo-identity` (signed in with the normal session cookie) returns `{ token, expiresAt }`. The token is
an HS256 JWT signed with `SERVIQO_IDENTITY_SECRET`:

| Claim | Value |
|---|---|
| `iss` | `bunty-store` |
| `aud` | `serviqo` |
| `sub` | the Bunty user id |
| `email`, `name` | the customer's email and name |
| `iat`, `exp` | issued now, valid for 10 minutes |
| `jti` | a random id |

The page hands it to the Serviqo widget; Serviqo checks it with the same secret and links the chat to that customer.
Without a valid pass the assistant sees no account data. The two secrets must be different, and Bunty refuses to
start if they are the same.
