import { UserModel, type OrderDoc } from "./models";
import { sendLater, type Mail, type Mailer } from "./mail";
import { returnDeadline } from "./policy";

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
};

const DEMO_NOTE =
  "Bunty Store is a demo store built to show Serviqo customer support. Nothing is really charged, shipped or refunded.";

interface Letter {
  subject: string;
  /** Short line shown by inboxes next to the subject. */
  preview: string;
  greeting: string;
  paragraphs: string[];
  /** The order's items and total, when the email is about an order. */
  order?: OrderDoc;
  button?: { label: string; url: string };
  idempotencyKey?: string;
}

/** One layout for every email: plain text and a simple HTML version that reads well in any inbox. */
function compose(to: string, l: Letter): Mail {
  const items = l.order?.items ?? [];
  const textItems = items.map((i) => `- ${i.name} x ${i.qty}: ${money(i.price * i.qty)}`);
  const text = [
    l.greeting,
    "",
    ...l.paragraphs.flatMap((p) => [p, ""]),
    ...(l.order ? [`Order ${l.order.number}`, ...textItems, `Total: ${money(l.order.total)}`, ""] : []),
    ...(l.button ? [`${l.button.label}: ${l.button.url}`, ""] : []),
    "Bunty Store",
    "",
    DEMO_NOTE,
  ].join("\n");

  const p = (s: string) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:${C.ink2}">${escapeHtml(s)}</p>`;
  const rows = items
    .map(
      (i) =>
        `<tr><td style="padding:8px 0;border-top:1px solid ${C.line};font-size:14px;color:${C.ink}">${escapeHtml(i.name)} × ${i.qty}</td>` +
        `<td style="padding:8px 0;border-top:1px solid ${C.line};font-size:14px;color:${C.ink};text-align:right;white-space:nowrap">${money(i.price * i.qty)}</td></tr>`,
    )
    .join("");
  const orderTable = l.order
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;border-collapse:collapse">` +
      `<tr><td colspan="2" style="padding:0 0 6px;font-size:13px;font-weight:700;color:${C.ink3}">ORDER ${escapeHtml(l.order.number)}</td></tr>` +
      rows +
      `<tr><td style="padding:10px 0 0;border-top:1px solid ${C.line};font-size:15px;font-weight:700;color:${C.ink}">Total</td>` +
      `<td style="padding:10px 0 0;border-top:1px solid ${C.line};font-size:15px;font-weight:700;color:${C.ink};text-align:right">${money(l.order.total)}</td></tr>` +
      `</table>`
    : "";
  const button = l.button
    ? `<p style="margin:4px 0 20px"><a href="${escapeHtml(l.button.url)}" style="display:inline-block;padding:12px 20px;border-radius:12px;background:${C.brand};color:${C.surface};font-size:15px;font-weight:700;text-decoration:none">${escapeHtml(l.button.label)}</a></p>`
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
    l.paragraphs.map(p).join("") +
    orderTable +
    button +
    `</td></tr>` +
    `<tr><td style="padding:14px 4px 0;font-size:12px;line-height:1.5;color:${C.ink3}">` +
    `<span style="display:inline-block;padding:2px 8px;border-radius:6px;background:${C.sun50};color:${C.ink2}">Demo store</span> ` +
    `${escapeHtml(DEMO_NOTE)}</td></tr>` +
    `</table></td></tr></table></body></html>`;

  return { to, subject: l.subject, text, html, idempotencyKey: l.idempotencyKey };
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
  const base = { greeting: hi, order, button: view, idempotencyKey: key };

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
        subject: `Order ${n} cancelled`,
        preview: "Nothing was charged.",
        paragraphs: [
          `Your order was cancelled${order.cancel?.reason ? ` (${order.cancel.reason})` : ""}.`,
          "Nothing was charged, so there is nothing to refund.",
        ],
      });
    case "return_requested":
      return compose(customer.email, {
        ...base,
        subject: `Return requested for ${n}`,
        preview: "We will let you know when it is approved.",
        paragraphs: [
          `We have your return request${order.return?.reason ? ` (${order.return.reason})` : ""}.`,
          "We will let you know when it is approved.",
        ],
      });
    case "return_approved":
      return compose(customer.email, {
        ...base,
        subject: `Return approved for ${n}`,
        preview: "We will pick up the items soon.",
        paragraphs: ["Your return was approved. We will pick up the items soon. Please keep them packed and ready."],
      });
    case "return_picked_up":
      return compose(customer.email, {
        ...base,
        subject: `Return picked up for ${n}`,
        preview: `Your refund of ${money(refund)} is on its way.`,
        paragraphs: [`We picked up your return. Your refund of ${money(refund)} is on its way.`],
      });
    case "return_refunded":
      return compose(customer.email, {
        ...base,
        subject: `Refund complete for ${n}`,
        preview: `${money(refund)} refunded.`,
        paragraphs: [`Your refund of ${money(refund)} is complete.`],
      });
    case "return_rejected": {
      const note = order.return?.timeline.at(-1)?.note;
      return compose(customer.email, {
        ...base,
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
