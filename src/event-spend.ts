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

/**
 * Included usage on current Cursor plans is billed against a dollar pool.
 * chargedCents stays 0; the cost lives on tokenUsage.totalCents.
 */
export function parseEventSpendCents(event: Record<string, unknown>): number {
  const charged = toFiniteNumber(event.chargedCents);
  if (charged !== null && charged !== 0) return charged;

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
