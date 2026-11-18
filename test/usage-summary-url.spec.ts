import { describe, expect, it } from "bun:test";
import { usageSummaryUrl } from "../src/cursor-api";

describe("usageSummaryUrl", () => {
  it("cache-busts the usage-summary GET so Refresh cannot reuse a stale CDN response", () => {
    expect(usageSummaryUrl(1_700_000_000_000)).toBe("https://cursor.com/api/usage-summary?_=1700000000000");
  });
});
