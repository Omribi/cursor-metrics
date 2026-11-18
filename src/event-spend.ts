export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function isChargeableEvent(event: Record<string, unknown>): boolean {
  return event.isChargeable === true || event.isChargeable === "true";
}

/**
 * Amount that actually hit the user's bill or included-dollar pool.
 * tokenUsage.totalCents is list price and is still populated for free-credit
 * models (Grok 4.6, Composer on some team licenses) that Cursor does not charge.
 */
export function parseEventSpendCents(event: Record<string, unknown>): number {
  const charged = toFiniteNumber(event.chargedCents);
  if (charged !== null && charged !== 0) return charged;

  if (!isChargeableEvent(event)) return charged ?? 0;

  const tokenUsage = asRecord(event.tokenUsage);
  const totalCents = tokenUsage ? toFiniteNumber(tokenUsage.totalCents) : null;
  if (totalCents !== null) return totalCents;

  return charged ?? 0;
}

export function countIncludedSpend(
  includedMetric: "requests" | "cents" | undefined,
  quotaAwareEventDisplay: boolean,
): boolean {
  if (includedMetric === "cents") return true;
  return quotaAwareEventDisplay === false;
}
