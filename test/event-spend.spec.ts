import { describe, expect, it } from "bun:test";
import { countIncludedSpend, parseEventSpendCents } from "../src/event-spend";

describe("parseEventSpendCents", () => {
  it("prefers chargedCents when it is non-zero", () => {
    expect(parseEventSpendCents({
      chargedCents: 124.73,
      tokenUsage: { totalCents: 121.41 },
    })).toBe(124.73);
  });

  it("uses tokenUsage.totalCents only when the event is chargeable and chargedCents is 0", () => {
    expect(parseEventSpendCents({
      chargedCents: 0,
      isChargeable: true,
      tokenUsage: { totalCents: 12.5 },
    })).toBe(12.5);
  });

  it("ignores list-price totalCents on free-credit models", () => {
    expect(parseEventSpendCents({
      chargedCents: 0,
      isChargeable: false,
      tokenUsage: { totalCents: 94.42040252685547 },
    })).toBe(0);
  });

  it("parses numeric strings from the dashboard API", () => {
    expect(parseEventSpendCents({
      chargedCents: "0",
      isChargeable: true,
      tokenUsage: { totalCents: "12.5" },
    })).toBe(12.5);
  });
});

describe("countIncludedSpend", () => {
  it("shows included dollar usage on spend-based plans even when quota-aware display is on", () => {
    expect(countIncludedSpend("cents", true)).toBe(true);
  });

  it("hides included spend on request-quota plans when quota-aware display is on", () => {
    expect(countIncludedSpend("requests", true)).toBe(false);
    expect(countIncludedSpend(undefined, true)).toBe(false);
  });
});
