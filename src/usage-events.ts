import type { UsageEvent } from "./cursor-api";

export function eventIdentity(event: UsageEvent): string {
  return [
    event.timestamp,
    event.model,
    event.kind,
    event.totalTokens,
    event.requests,
    event.spendCents,
    event.maxMode ? 1 : 0,
  ].join("|");
}

/** Keep already-loaded history and prepend events that only appeared on a fresh first page. */
export function mergeNewestEvents(existing: UsageEvent[], incoming: UsageEvent[]): UsageEvent[] {
  if (existing.length === 0) return incoming.slice();
  if (incoming.length === 0) return existing.slice();

  const seen = new Set(existing.map(eventIdentity));
  const extra = incoming.filter((event) => !seen.has(eventIdentity(event)));
  if (extra.length === 0) return existing.slice();
  return extra.concat(existing);
}
