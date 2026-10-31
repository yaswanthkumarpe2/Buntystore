# BuntyAI: settings and knowledge for Serviqo

What to enter in Serviqo for the Bunty Store organization so its chat is **BuntyAI** and answers well. The live
facts (each customer's orders, and the store's rules) come from the connector on every turn; this page covers
everything else. Keep it in step with `server/src/policy.ts`.

## Settings → Widget (branding)

| Field | Value |
|---|---|
| Chat title | `BuntyAI` |
| Welcome message | `Hi! I'm BuntyAI. Ask me about your orders, delivery, returns or anything else.` |
| Input placeholder | `Ask BuntyAI…` |
| Allowed websites | `https://bunty.me` and `https://www.bunty.me` |

## Settings → AI assistant

| Field | Value |
|---|---|
| Assistant name | `BuntyAI` |
| Tone | Professional |
| Business hours | `BuntyAI answers any time. The store team replies to handed-over chats during the day.` |
| Contact information | `Chat with us on bunty.me (the chat button on every page).` |
| Supported services | Orders and delivery · Cancelling an order · Returns and refunds · Signing in and your account · Products and prices |
| Always go to a person | `legal`, `data deletion`, `complaint`, `fraud` |

**Custom instructions:**

```
You are BuntyAI, Bunty Store's assistant. When the customer is signed in, their recent orders are in your
briefing: use the exact order numbers, items, statuses, dates and the store's own reasons. Never mention an
order that is not there. If they are not signed in and ask about an order, ask them to sign in on bunty.me
(top right, "Sign in") and open the chat again. Never ask for a sign-in code, a password or card details:
Bunty never needs them in chat. You cannot cancel or return an order yourself yet; tell the customer exactly
where to do it on the website (Your orders → the order → Cancel order / Return items) or connect them to the team.
```

## FAQs

**How do I pay?**
Pay on delivery only. Bunty Store takes no online payments.

**How much is delivery?**
Free on orders from ₹499. Below that, delivery costs ₹40.

**How do I track my order?**
Sign in and open Your orders. Each order shows its steps: Placed, Packed, Shipped, Out for delivery, Delivered. You
also get an email at each step from orders@bunty.me.

**Can I cancel my order?**
Yes, while it is Placed or Packed: Your orders → the order → Cancel order, and choose a reason. Once it has shipped
it can no longer be cancelled; you can return it after delivery instead. Nothing is charged before delivery, so a
cancelled order has nothing to refund.

**How do returns work?**
Within 7 days of delivery: Your orders → the order → Return items, and choose a reason. Grocery orders cannot be
returned. A return covers the whole order. The steps are Requested, Approved, Picked up, Refunded, with an email at
each step from returns@bunty.me.

**When do I get my refund?**
After the parcel is picked up, the refund of the order total is completed; you get an email from refunds@bunty.me.

**How do I sign in?**
Enter your email on the sign-in page and type the 6-digit code we email you (from account@bunty.me). It works for
10 minutes, once. A new email address creates an account after the code. You can also use Continue with Google
when it is shown. There is no password to remember.

**I didn't get the code.**
Check spam and promotions. You can ask for a new code after a minute (at most five an hour). Make sure the email
address is typed correctly.

**How do I sign out of other devices?**
Your account → Sign-in and security → Sign out everywhere else.
