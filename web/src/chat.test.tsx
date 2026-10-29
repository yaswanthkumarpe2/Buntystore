import { afterEach, describe, expect, it } from "vitest";

import { loadServiqoChat } from "./chat";

const KEY = "wk_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
const tags = () => document.querySelectorAll("script[data-serviqo-widget-key]");

afterEach(() => tags().forEach((t) => t.remove()));

describe("the Serviqo chat", () => {
  it("loads widget.js once, with the widget key on the tag", () => {
    expect(loadServiqoChat({ scriptUrl: "https://serviqo.live/widget.js", widgetKey: KEY })).toBe(true);
    expect(loadServiqoChat({ scriptUrl: "https://serviqo.live/widget.js", widgetKey: KEY })).toBe(false);
    expect(tags()).toHaveLength(1);
    const tag = tags()[0] as HTMLScriptElement;
    expect(tag.src).toBe("https://serviqo.live/widget.js");
    expect(tag.getAttribute("data-serviqo-widget-key")).toBe(KEY);
  });

  it("loads nothing when the chat is not set up", () => {
    expect(loadServiqoChat(null)).toBe(false);
    expect(tags()).toHaveLength(0);
  });

  it("refuses a plain http address that is not on this computer", () => {
    expect(loadServiqoChat({ scriptUrl: "http://serviqo.live/widget.js", widgetKey: KEY })).toBe(false);
    expect(loadServiqoChat({ scriptUrl: "javascript:alert(1)", widgetKey: KEY })).toBe(false);
    expect(tags()).toHaveLength(0);
    expect(loadServiqoChat({ scriptUrl: "http://localhost:3001/widget.js", widgetKey: KEY })).toBe(true);
  });
});
