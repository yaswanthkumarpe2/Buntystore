import { CATEGORIES, UserModel, type OrderDoc } from "./models";
import { sendLater, type Mail, type Mailer, type Sender } from "./mail";
import { FREE_DELIVERY_FROM, RETURN_WINDOW_DAYS, returnDeadline } from "./policy";

/** Email is on when a mailer is set up; links in emails point at the site's public address. */
export interface EmailSetup {
  mailer: Mailer;
  siteUrl: string;
}

/** The moments a customer hears about by email. "Packed" is not one: shipping follows soon after. */
export type OrderEvent =
  | "placed"
  | "shipped"
  | "out_for_delivery"
  | "delivered"
  | "cancelled"
  | "return_requested"
  | "return_approved"
  | "return_picked_up"
  | "return_refunded"
  | "return_rejected";

const ORDER_EVENTS = new Set<string>([
  "placed",
  "shipped",
  "out_for_delivery",
  "delivered",
  "cancelled",
  "return_requested",
  "return_approved",
  "return_picked_up",
  "return_refunded",
  "return_rejected",
]);

export const isOrderEvent = (s: string): s is OrderEvent => ORDER_EVENTS.has(s);

// ---------------------------------------------------------------- formatting

const rupees = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const money = (n: number) => rupees.format(n);
const day = (d: Date) =>
  d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const firstName = (name: string) => name.trim().split(/\s+/)[0] || "there";

// Bunty's colours (web/src/styles.css), written out: email clients do not read CSS variables.
const C = {
  brand: "#5b3df5",
  ink: "#1b1b2f",
  ink2: "#4b4b63",
  ink3: "#6b6b80",
  line: "#e6e6ef",
  canvas: "#f6f6fa",
  surface: "#ffffff",
  sun50: "#fff6dc",
  ok: "#127a4b",
};

/** The line under every email: what shopping at Bunty means, in one breath. */
const FOOTER = `Pay on delivery · Free delivery from ${money(FREE_DELIVERY_FROM)} · ${RETURN_WINDOW_DAYS}-day returns`;
const HELP = "Questions? Use the chat on our website and we'll help.";

/** The product picture's tile colour, as hex: email clients do not all read hsl(). */
function tileColour(hue: number): string {
  const l = 0.92;
  const s = 0.7;
  const k = (n: number) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${[f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("")}`;
}

interface Letter {
  /** Which Bunty address it comes from. */
  sender: Sender;
  subject: string;
  /** Short line shown by inboxes next to the subject. */
  preview: string;
  greeting: string;
  paragraphs: string[];
  /** The order's items and total, when the email is about an order. */
  order?: OrderDoc;
  /** Links each item to its product page. */
  siteUrl?: string;
  /** A refund to show under the total, when the email is about one. */
  refund?: number;
  /** Says the total was never charged (a cancelled order). */
  notCharged?: boolean;
  /** A sign-in code, shown large so it is easy to read and copy. */
  code?: string;
  button?: { label: string; url: string };
  /** Links to the shop's categories, under the button. */
  links?: { label: string; url: string }[];
  idempotencyKey?: string;
}

/** One layout for every email: plain text and a simple HTML version that reads well in any inbox. */
function compose(to: string, l: Letter): Mail {
  const items = l.order?.items ?? [];
  const textItems = items.map((i) => `- ${i.name}: ${i.qty} × ${money(i.price)} = ${money(i.price * i.qty)}`);
  const delivery = l.order ? (l.order.deliveryFee === 0 ? "Free" : money(l.order.deliveryFee)) : "";
  const totalLabel = l.notCharged ? "Total (not charged)" : "Total";
  const text = [
    l.greeting,
    "",
    ...(l.code ? [`Your code: ${l.code}`, ""] : []),
    ...l.paragraphs.flatMap((p) => [p, ""]),
    ...(l.order
      ? [
          `Order ${l.order.number}`,
          ...textItems,
          `Subtotal: ${money(l.order.subtotal)}`,
          `Delivery: ${delivery}`,
          `${totalLabel}: ${money(l.order.total)}`,
          ...(l.refund !== undefined ? [`Refund: ${money(l.refund)}`] : []),
          "",
        ]
      : []),
    ...(l.button ? [`${l.button.label}: ${l.button.url}`, ""] : []),
    ...(l.links ? [...l.links.map((k) => `${k.label}: ${k.url}`), ""] : []),
    "Bunty Store",
    FOOTER,
    HELP,
  ].join("\n");

  const p = (s: string) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:${C.ink2}">${escapeHtml(s)}</p>`;
  const cell = `border-top:1px solid ${C.line};font-size:14px;color:${C.ink}`;
  const rows = items
    .map((i) => {
      const name = l.siteUrl
        ? `<a href="${escapeHtml(`${l.siteUrl}/p/${encodeURIComponent(i.slug)}`)}" style="color:${C.ink};font-weight:600;text-decoration:none">${escapeHtml(i.name)}</a>`
        : `<span style="font-weight:600">${escapeHtml(i.name)}</span>`;
      return (
        `<tr><td width="60" style="padding:10px 12px 10px 0;${cell};vertical-align:top">` +
        `<div style="width:48px;height:48px;border-radius:10px;background:${tileColour(i.hue)};text-align:center;line-height:48px;font-size:26px">${escapeHtml(i.emoji)}</div></td>` +
        `<td style="padding:10px 0;${cell};vertical-align:top">${name}` +
        `<div style="margin-top:3px;font-size:13px;color:${C.ink3}">Qty ${i.qty} · ${money(i.price)} each</div></td>` +
        `<td style="padding:10px 0 10px 8px;${cell};text-align:right;white-space:nowrap;vertical-align:top;font-weight:600">${money(i.price * i.qty)}</td></tr>`
      );
    })
    .join("");
  const sumRow = (label: string, value: string, strong = false) => {
    const style = strong
      ? `padding:10px 0 0;font-size:15px;font-weight:700;color:${C.ink};border-top:1px solid ${C.line}`
      : `padding:6px 0 0;font-size:14px;color:${C.ink2}`;
    return `<tr><td colspan="2" style="${style}">${escapeHtml(label)}</td><td style="${style};text-align:right;white-space:nowrap">${escapeHtml(value)}</td></tr>`;
  };
  const orderTable = l.order
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;border-collapse:collapse">` +
      `<tr><td colspan="3" style="padding:0 0 6px;font-size:13px;font-weight:700;letter-spacing:0.4px;color:${C.ink3}">ORDER ${escapeHtml(l.order.number)}</td></tr>` +
      rows +
      `<tr><td colspan="3" style="padding:4px 0 0;border-top:1px solid ${C.line}"></td></tr>` +
      sumRow("Subtotal", money(l.order.subtotal)) +
      sumRow("Delivery", delivery) +
      sumRow(totalLabel, money(l.order.total), true) +
      (l.refund !== undefined
        ? `<tr><td colspan="2" style="padding:8px 0 0;font-size:15px;font-weight:700;color:${C.ok}">Refund</td>` +
          `<td style="padding:8px 0 0;font-size:15px;font-weight:700;color:${C.ok};text-align:right;white-space:nowrap">${money(l.refund)}</td></tr>`
        : "") +
      `</table>`
    : "";
  const button = l.button
    ? `<p style="margin:4px 0 20px"><a href="${escapeHtml(l.button.url)}" style="display:inline-block;padding:12px 20px;border-radius:12px;background:${C.brand};color:${C.surface};font-size:15px;font-weight:700;text-decoration:none">${escapeHtml(l.button.label)}</a></p>`
    : "";
  const code = l.code
    ? `<p style="margin:2px 0 18px"><span style="display:inline-block;padding:12px 18px;border-radius:12px;background:${C.canvas};border:1px solid ${C.line};font-family:Consolas,Menlo,monospace;font-size:30px;font-weight:700;letter-spacing:8px;color:${C.ink}">${escapeHtml(l.code)}</span></p>`
    : "";
  const links = l.links
    ? `<p style="margin:0 0 6px;font-size:14px;line-height:2;color:${C.ink2}">` +
      l.links.map((k) => `<a href="${escapeHtml(k.url)}" style="color:${C.brand};font-weight:600;text-decoration:none">${escapeHtml(k.label)}</a>`).join(" &nbsp;·&nbsp; ") +
      `</p>`
    : "";

  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">` +
    `<title>${escapeHtml(l.subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:${C.canvas};font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif">` +
    `<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(l.preview)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.canvas}"><tr><td align="center" style="padding:24px 12px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">` +
    `<tr><td style="padding:0 0 14px;font-size:20px;font-weight:800;color:${C.brand}">bunty<span style="color:${C.ink}">store</span></td></tr>` +
    `<tr><td style="padding:24px;border:1px solid ${C.line};border-radius:12px;background:${C.surface}">` +
    `<p style="margin:0 0 14px;font-size:17px;font-weight:700;color:${C.ink}">${escapeHtml(l.greeting)}</p>` +
    code +
    l.paragraphs.map(p).join("") +
    orderTable +
    button +
    links +
    `</td></tr>` +
    `<tr><td style="padding:14px 4px 0;font-size:12px;line-height:1.5;color:${C.ink3}">` +
    `${escapeHtml(FOOTER)}<br>${escapeHtml(HELP)}</td></tr>` +
    `</table></td></tr></table></body></html>`;

  return { sender: l.sender, to, subject: l.subject, text, html, idempotencyKey: l.idempotencyKey };
}

// ---------------------------------------------------------------- order emails

/** The email for one moment in an order's life. */
export function orderMail(
  order: OrderDoc,
  event: OrderEvent,
  customer: { name: string; email: string },
  siteUrl: string,
): Mail {
  const n = order.number;
  const hi = `Hi ${firstName(customer.name)},`;
  const view = { label: "View your order", url: `${siteUrl}/orders/${encodeURIComponent(n)}` };
  const key = `${n}:${event}`;
  const refund = order.refund?.amount ?? order.total;
  const base = { greeting: hi, order, siteUrl, button: view, idempotencyKey: key, sender: "orders" as Sender };
  const returns = { ...base, sender: "returns" as Sender };

  switch (event) {
    case "placed":
      return compose(customer.email, {
        ...base,
        subject: `Order ${n} placed`,
        preview: `It should reach you by ${day(order.expectedDelivery)}.`,
        paragraphs: [
          `Thanks for shopping with us. We have your order and it should reach you by ${day(order.expectedDelivery)}.`,
          "You pay on delivery. You can cancel it until it ships.",
        ],
      });
    case "shipped":
      return compose(customer.email, {
        ...base,
        subject: `Your order ${n} has shipped`,
        preview: `On its way, due ${day(order.expectedDelivery)}.`,
        paragraphs: [`Your order is on its way and should reach you by ${day(order.expectedDelivery)}.`],
      });
    case "out_for_delivery":
      return compose(customer.email, {
        ...base,
        subject: `Out for delivery: ${n}`,
        preview: "Your order reaches you today.",
        paragraphs: [`Your order reaches you today. Please keep ${money(order.total)} ready to pay on delivery.`],
      });
    case "delivered": {
      const until = order.deliveredAt ? ` until ${day(returnDeadline(order.deliveredAt))}` : "";
      return compose(customer.email, {
        ...base,
        subject: `Delivered: ${n}`,
        preview: "Your order was delivered.",
        paragraphs: [`Your order was delivered. If something is not right, you can return eligible items${until}.`],
      });
    }
    case "cancelled":
      return compose(customer.email, {
        ...base,
        notCharged: true,
        subject: `Order ${n} cancelled`,
        preview: "Nothing was charged.",
        paragraphs: [
          `Your order was cancelled${order.cancel?.reason ? ` (${order.cancel.reason})` : ""}.`,
          "Nothing was charged, so there is nothing to refund.",
        ],
      });
    case "return_requested":
      return compose(customer.email, {
        ...returns,
        subject: `Return requested for ${n}`,
        preview: "We will let you know when it is approved.",
        paragraphs: [
          `We have your return request${order.return?.reason ? ` (${order.return.reason})` : ""}.`,
          "We will let you know when it is approved.",
        ],
      });
    case "return_approved":
      return compose(customer.email, {
        ...returns,
        subject: `Return approved for ${n}`,
        preview: "We will pick up the items soon.",
        paragraphs: ["Your return was approved. We will pick up the items soon. Please keep them packed and ready."],
      });
    case "return_picked_up":
      return compose(customer.email, {
        ...returns,
        refund,
        subject: `Return picked up for ${n}`,
        preview: `Your refund of ${money(refund)} is on its way.`,
        paragraphs: [`We picked up your return. Your refund of ${money(refund)} is on its way.`],
      });
    case "return_refunded":
      return compose(customer.email, {
        ...base,
        sender: "refunds",
        refund,
        subject: `Refund complete for ${n}`,
        preview: `${money(refund)} refunded.`,
        paragraphs: [`Your refund of ${money(refund)} is complete.`],
      });
    case "return_rejected": {
      const note = order.return?.timeline.at(-1)?.note;
      return compose(customer.email, {
        ...returns,
        subject: `Return declined for ${n}`,
        preview: "We could not accept this return.",
        paragraphs: [
          `We could not accept your return${note ? `: ${note}` : "."}`,
          "If you think this is wrong, reply through the chat on our website and we will look again.",
        ],
      });
    }
  }
}

/**
 * Tells the order's customer what just happened, in the background. Every way an
 * order changes (the website, the store team page, Serviqo's connector) calls this.
 */
export type OrderNotifier = (order: OrderDoc, event: OrderEvent) => void;

export function orderNotifier(email: EmailSetup | undefined): OrderNotifier {
  if (!email) return () => undefined;
  return (order, event) => {
    void UserModel.findById(order.userId, { name: 1, email: 1 })
      .lean()
      .then((user) => {
        if (user) sendLater(email.mailer, orderMail(order, event, user, email.siteUrl), `order ${event}`);
      })
      .catch(() => console.error(`Email not sent (order ${event}): customer lookup failed`));
  };
}

// ---------------------------------------------------------------- password emails

export const RESET_MINUTES = 30;

export function passwordResetMail(customer: { name: string; email: string }, link: string): Mail {
  return compose(customer.email, {
    sender: "account",
    subject: "Reset your Bunty Store password",
    preview: `This link works for ${RESET_MINUTES} minutes.`,
    greeting: `Hi ${firstName(customer.name)},`,
    paragraphs: [
      `Someone asked to reset the password for your Bunty Store account. The link below works once, for ${RESET_MINUTES} minutes.`,
      "If it was not you, ignore this email: your password stays the same.",
    ],
    button: { label: "Choose a new password", url: link },
  });
}

export function passwordChangedMail(customer: { name: string; email: string }, siteUrl: string): Mail {
  return compose(customer.email, {
    sender: "account",
    subject: "Your Bunty Store password was changed",
    preview: "You were signed out everywhere else.",
    greeting: `Hi ${firstName(customer.name)},`,
    paragraphs: [
      "Your password was just changed, and every other device was signed out.",
      "If this was not you, reset your password again now and tell us through the chat on our website.",
    ],
    button: { label: "Go to Bunty Store", url: siteUrl },
  });
}

// ---------------------------------------------------------------- sign-in emails

export const CODE_MINUTES = 10;

/** The 6-digit code for signing in (or, for a new address, creating the account). */
export function signInCodeMail(to: string, code: string, newAccount: boolean): Mail {
  return compose(to, {
    sender: "account",
    subject: `${code} is your Bunty Store code`,
    preview: `It works for ${CODE_MINUTES} minutes.`,
    greeting: newAccount ? "Welcome to Bunty Store!" : "Hi there,",
    code,
    paragraphs: [
      newAccount
        ? `Enter this code on Bunty Store to create your account. It works for ${CODE_MINUTES} minutes.`
        : `Enter this code on Bunty Store to sign in. It works for ${CODE_MINUTES} minutes.`,
      "Never share it: Bunty Store will never ask you for this code by phone, chat or email.",
      "If you did not ask for it, ignore this email. Nobody can sign in without the code.",
    ],
  });
}

/** Sent once, when an account is created: what the store has and where to start. */
export function welcomeMail(customer: { name: string; email: string }, siteUrl: string): Mail {
  return compose(customer.email, {
    sender: "hello",
    subject: "Welcome to Bunty Store",
    preview: "60 products across six categories, pay on delivery.",
    greeting: `Hi ${firstName(customer.name)}, welcome!`,
    paragraphs: [
      "Your Bunty Store account is ready. Have a look around: phones and headphones, clothes, things for the home, books, beauty and groceries.",
      `Pay on delivery, free delivery from ${money(FREE_DELIVERY_FROM)}, and returns within ${RETURN_WINDOW_DAYS} days of delivery (except groceries). Your orders and returns are always under Your orders.`,
    ],
    button: { label: "Start exploring", url: siteUrl },
    links: CATEGORIES.map((c) => ({ label: c.name, url: `${siteUrl}/c/${c.id}` })),
    idempotencyKey: `welcome:${customer.email}`,
  });
}

/** Sent when a password is added to an account that had none. */
export function passwordAddedMail(customer: { name: string; email: string }, siteUrl: string): Mail {
  return compose(customer.email, {
    sender: "account",
    subject: "A password was added to your Bunty Store account",
    preview: "You can now also sign in with a password.",
    greeting: `Hi ${firstName(customer.name)},`,
    paragraphs: [
      "A password was just added to your account, so you can now sign in with it as well as with an email code. Every other device was signed out.",
      "If this was not you, sign in with an email code, change the password under Your account, and tell us through the chat on our website.",
    ],
    button: { label: "Go to Bunty Store", url: siteUrl },
  });
}
