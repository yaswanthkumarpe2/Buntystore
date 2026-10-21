import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { money, percentOff } from "./api";
import { Price, Tracker } from "./ui";

afterEach(cleanup);

describe("prices", () => {
  it("shows rupees the Indian way, with the saving", () => {
    expect(money(13999)).toBe("₹13,999");
    expect(percentOff({ price: 13999, mrp: 17999 })).toBe(22);
    render(<Price p={{ price: 499, mrp: 999 }} />);
    expect(screen.getByText("₹499")).toBeDefined();
    expect(screen.getByText("50% off")).toBeDefined();
  });

  it("shows no saving when there is none", () => {
    render(<Price p={{ price: 99, mrp: 99 }} />);
    expect(screen.queryByText(/off/)).toBeNull();
  });
});

describe("order tracker", () => {
  it("marks every step up to the current one as done", () => {
    render(<Tracker status="shipped" times={{ placed: "2026-10-20T10:00:00Z" }} />);
    expect(screen.getByText(/Ordered/).textContent).toContain("(done)");
    expect(screen.getByText(/Shipped/).textContent).toContain("(done)");
    expect(screen.getByText(/Out for delivery/).textContent).toContain("(not yet)");
    expect(screen.getByText(/^Delivered/).textContent).toContain("(not yet)");
  });
});
