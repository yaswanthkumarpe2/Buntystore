import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { prefetch, readRemembered, useRemembered } from "./api";
import { productTransition } from "./nav";

const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("remembered reads", () => {
  it("shares one request between reads of the same address at the same moment", async () => {
    const fetchMock = vi.fn(() => ok({ n: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const [a, b] = await Promise.all([readRemembered("/products?x=1"), readRemembered("/products?x=1")]);
    expect(a).toEqual({ n: 1 });
    expect(b).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not read again what was just read, so a page opened after a hover is instant", async () => {
    const fetchMock = vi.fn(() => ok({ product: { name: "Pulse" } }));
    vi.stubGlobal("fetch", fetchMock);
    prefetch("/products/pulse");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    prefetch("/products/pulse");

    function Page() {
      const { data } = useRemembered<{ product: { name: string } }>("/products/pulse");
      return <p>{data ? data.product.name : "loading"}</p>;
    }
    render(<Page />);
    expect(screen.getByText("Pulse")).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives a plain error when the read fails", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: { code: "NOT_FOUND", message: "That product was not found." } }) } as Response)));
    function Page() {
      const { error } = useRemembered("/products/missing");
      return <p>{error ?? "loading"}</p>;
    }
    render(<Page />);
    await waitFor(() => expect(screen.getByText("That product was not found.")).toBeDefined());
  });
});

describe("page transitions", () => {
  it("names a product's picture safely for the glide between pages", () => {
    expect(productTransition("pulse-wireless-earbuds")).toBe("p-pulse-wireless-earbuds");
    expect(productTransition("4k tv/<x>")).toBe("p-4ktvx");
  });
});
