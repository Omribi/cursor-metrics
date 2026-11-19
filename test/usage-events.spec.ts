import { describe, expect, it } from "bun:test";
import type { UsageEvent } from "../src/cursor-api";
import { mergeNewestEvents } from "../src/usage-events";

function event(partial: Partial<UsageEvent> & Pick<UsageEvent, "timestamp" | "model">): UsageEvent {
  return {
    kind: "Included",
    totalTokens: 1000,
    requests: 1,
    spendCents: 0,
    maxMode: false,
    ...partial,
  };
}

describe("mergeNewestEvents", () => {
  it("returns incoming events when nothing is cached yet", () => {
    const incoming = [event({ timestamp: 2, model: "cursor-grok-4.5-high" })];
    expect(mergeNewestEvents([], incoming)).toEqual(incoming);
  });

  it("prepends a brand-new first-page event without dropping cached history", () => {
    const existing = [
      event({ timestamp: 1, model: "cursor-grok-4.6-xhigh-fast", totalTokens: 478_700 }),
    ];
    const incoming = [
      event({ timestamp: 2, model: "cursor-grok-4.5-high", totalTokens: 16_500 }),
      existing[0]!,
    ];

    const merged = mergeNewestEvents(existing, incoming);
    expect(merged.map((row) => row.model)).toEqual([
      "cursor-grok-4.5-high",
      "cursor-grok-4.6-xhigh-fast",
    ]);
  });

  it("does not duplicate events already in the cache", () => {
    const existing = [event({ timestamp: 1, model: "grok-4.7-xhigh", spendCents: 2 })];
    expect(mergeNewestEvents(existing, existing)).toEqual(existing);
  });
});
