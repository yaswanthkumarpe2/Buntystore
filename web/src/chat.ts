/** Where the Serviqo chat comes from, as the server's /api/store tells it; null when the chat is not set up. */
export interface ChatSetup {
  scriptUrl: string;
  widgetKey: string;
  /** A path on this site that gives the signed-in customer's pass for the chat; null when that is off. */
  identityUrl?: string | null;
}

const MARK = "data-serviqo-widget-key";
const IDENTITY = "data-serviqo-identity-url";
const IDENTITY_CHANGED = "serviqo:identity-changed";

/**
 * Puts the Serviqo chat on the page by loading its widget.js once, with Bunty's
 * widget key on the tag (the widget reads the key, and its own address, from the
 * tag that loaded it). Only an https address, or one on this computer, is loaded.
 */
export function loadServiqoChat(chat: ChatSetup | null, doc: Document = document): boolean {
  if (!chat || doc.querySelector(`script[${MARK}]`)) return false;
  let url: URL;
  try {
    url = new URL(chat.scriptUrl);
  } catch {
    return false;
  }
  const local = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !local) return false;

  const tag = doc.createElement("script");
  tag.src = url.href;
  tag.async = true;
  tag.setAttribute(MARK, chat.widgetKey);
  // only a path on this site: the chat fetches it with the customer's session cookie
  if (chat.identityUrl?.startsWith("/") && !chat.identityUrl.startsWith("//")) tag.setAttribute(IDENTITY, chat.identityUrl);
  doc.body.appendChild(tag);
  return true;
}

/** Tells the chat that someone signed in or out, so it starts again as the right person. */
export function serviqoIdentityChanged(win: Window = window): void {
  win.dispatchEvent(new Event(IDENTITY_CHANGED));
}
