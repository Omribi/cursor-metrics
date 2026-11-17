import { describe, expect, it } from "bun:test";
import { extractUsageFromSummary } from "../src/usage-summary";

describe("extractUsageFromSummary", () => {
  it("maps included spend cents and pool percentages from individual usage", () => {
    const payload = extractUsageFromSummary(
      {
        billingCycleEnd: "2026-12-01T00:00:00.000Z",
        individualUsage: {
          plan: {
            enabled: true,
            used: 2943,
            limit: 40000,
            autoPercentUsed: 2.75,
            apiPercentUsed: 0.376,
            totalPercentUsed: 1.96,
            breakdown: { included: 2943, bonus: 0, total: 2943 },
          },
          onDemand: { enabled: false, used: 0, limit: null },
        },
      },
      false,
    );

    expect(payload).not.toBeNull();
    expect(payload?.includedMetric).toBe("cents");
    expect(payload?.includedRequests).toEqual({ used: 2943, limit: 40000 });
    expect(payload?.poolUsage).toEqual({
      autoPercentUsed: 2.75,
      apiPercentUsed: 0.376,
      totalPercentUsed: 1.96,
    });
    expect(payload?.onDemand.state).toBe("disabled");
    expect(payload?.resetsAt).toBe("2026-12-01T00:00:00.000Z");
  });

  it("falls back to team plan when individual plan is missing", () => {
    const payload = extractUsageFromSummary(
      {
        teamUsage: {
          plan: {
            enabled: true,
            used: 1200,
            limit: 10000,
            autoPercentUsed: 12,
            apiPercentUsed: 4,
            totalPercentUsed: 8,
          },
          onDemand: { enabled: true, used: 150, limit: 5000 },
        },
      },
      true,
    );

    expect(payload?.includedRequests).toEqual({ used: 1200, limit: 10000 });
    expect(payload?.poolUsage?.autoPercentUsed).toBe(12);
    expect(payload?.onDemand).toEqual({
      state: "limited",
      spendDollars: 1.5,
      limitDollars: 50,
    });
  });

  it("reads enterprise overall included spend when plan is missing", () => {
    const payload = extractUsageFromSummary(
      {
        billingCycleEnd: "2026-12-01T00:00:00.000Z",
        individualUsage: {
          overall: {
            enabled: true,
            used: 4595,
            limit: 15000,
            remaining: 10405,
          },
        },
        teamUsage: {
          onDemand: { enabled: false, used: 0, limit: null },
        },
      },
      true,
    );

    expect(payload?.includedMetric).toBe("cents");
    expect(payload?.includedRequests).toEqual({ used: 4595, limit: 15000 });
    expect(payload?.poolUsage).toBeNull();
    expect(payload?.onDemand.state).toBe("disabled");
  });

  it("keeps a payload that only has pool percentages", () => {
    const payload = extractUsageFromSummary(
      {
        individualUsage: {
          plan: {
            enabled: true,
            autoPercentUsed: 41.2,
            apiPercentUsed: 8,
            totalPercentUsed: 24,
          },
        },
      },
      false,
    );

    expect(payload?.includedRequests).toEqual({ used: 0, limit: 0 });
    expect(payload?.poolUsage?.autoPercentUsed).toBe(41.2);
  });
});
