import { describe, expect, it } from "bun:test";
import type { UsagePayload } from "../src/cursor-api";
import {
  formatIncludedUsage,
  formatMinimalStatusBarUsageText,
  formatStatusBarUsageText,
} from "../src/usage-display";

const requestPayload: UsagePayload = {
  includedRequests: { used: 120, limit: 500 },
  onDemand: { state: "disabled", spendDollars: 0, limitDollars: null },
  resetsAt: null,
};

describe("status bar usage text", () => {
  it("keeps the legacy request counter", () => {
    expect(formatIncludedUsage(requestPayload)).toBe("120/500");
    expect(formatStatusBarUsageText(requestPayload)).toBe("120/500");
  });

  it("formats included spend in dollars", () => {
    const payload: UsagePayload = {
      includedRequests: { used: 2943, limit: 40000 },
      includedMetric: "cents",
      onDemand: { state: "disabled", spendDollars: 0, limitDollars: null },
      resetsAt: null,
    };
    expect(formatStatusBarUsageText(payload)).toBe("$29.43/$400.00");
  });

  it("shows included spend when both spend and pool percentages exist", () => {
    const payload: UsagePayload = {
      includedRequests: { used: 2943, limit: 40000 },
      includedMetric: "cents",
      poolUsage: { autoPercentUsed: 2.75, apiPercentUsed: 0.376, totalPercentUsed: 1.96 },
      onDemand: { state: "limited", spendDollars: 12.5, limitDollars: 100 },
      resetsAt: null,
    };
    expect(formatStatusBarUsageText(payload)).toBe("$29.43/$400.00 | $12.50/$100.00");
    expect(formatMinimalStatusBarUsageText(payload)).toBe("$29.43/$400.00");
  });

  it("falls back to Auto and API percentages when included totals are empty", () => {
    const payload: UsagePayload = {
      includedRequests: { used: 0, limit: 0 },
      poolUsage: { autoPercentUsed: 12.5, apiPercentUsed: 4, totalPercentUsed: 8 },
      onDemand: { state: "disabled", spendDollars: 0, limitDollars: null },
      resetsAt: null,
    };
    expect(formatStatusBarUsageText(payload)).toBe("12.5% Auto | 4% API");
    expect(formatMinimalStatusBarUsageText(payload)).toBe("8% used");
  });
});
