/** Where the Serviqo chat comes from, as the server's /api/store tells it; null when the chat is not set up. */
export interface ChatSetup {
  scriptUrl: string;
  widgetKey: string;
}

const MARK = "data-serviqo-widget-key";

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
  doc.body.appendChild(tag);
  return true;
}
