import type { UsagePayload } from "./cursor-api";

type NumberWithSource = { value: number; source: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function nextMonth(iso: string): string {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + 1);
  return d.toISOString();
}

function pickNumber(record: Record<string, unknown>, fields: string[]): NumberWithSource | null {
  for (const field of fields) {
    const value = toNumber(record[field]);
    if (value !== null) {
      return { value, source: field };
    }
  }
  return null;
}

function extractOnDemandFromSummaryBlock(
  block: Record<string, unknown> | null,
  stripeOnDemandEnabled: boolean,
): UsagePayload["onDemand"] {
  if (block && block.enabled === false) {
    return { state: "disabled", spendDollars: 0, limitDollars: null };
  }
  if (!block) {
    return stripeOnDemandEnabled
      ? { state: "unlimited", spendDollars: 0, limitDollars: null }
      : { state: "disabled", spendDollars: 0, limitDollars: null };
  }

  const usedCents = toNumber(block.used) ?? 0;
  const spendDollars = usedCents / 100;
  const limitCents = toNumber(block.limit);

  if (limitCents !== null && limitCents > 0) {
    return {
      state: "limited",
      spendDollars,
      limitDollars: limitCents / 100,
    };
  }

  return { state: "unlimited", spendDollars, limitDollars: null };
}

function extractPoolUsageFromPlan(plan: Record<string, unknown>): UsagePayload["poolUsage"] {
  const autoPercentUsed = toNumber(plan.autoPercentUsed);
  const apiPercentUsed = toNumber(plan.apiPercentUsed);
  const totalPercentUsed = toNumber(plan.totalPercentUsed);
  if (autoPercentUsed === null && apiPercentUsed === null && totalPercentUsed === null) {
    return null;
  }
  return {
    autoPercentUsed: autoPercentUsed ?? 0,
    apiPercentUsed: apiPercentUsed ?? 0,
    totalPercentUsed: totalPercentUsed ?? 0,
  };
}

function pickPlanLike(container: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!container) return null;
  const plan = asRecord(container.plan);
  if (plan && plan.enabled !== false) return plan;
  const overall = asRecord(container.overall);
  if (overall && overall.enabled !== false) return overall;
  return null;
}

function pickUsageBlocks(summary: Record<string, unknown>): {
  plan: Record<string, unknown>;
  individualOnDemand: Record<string, unknown> | null;
  teamOnDemand: Record<string, unknown> | null;
} | null {
  const individual = asRecord(summary.individualUsage);
  const team = asRecord(summary.teamUsage);
  const individualOnDemand = individual ? asRecord(individual.onDemand) : null;
  const teamOnDemand = team ? asRecord(team.onDemand) : null;

  const individualPlan = pickPlanLike(individual);
  if (individualPlan) {
    return { plan: individualPlan, individualOnDemand, teamOnDemand };
  }
  const teamPlan = pickPlanLike(team);
  if (teamPlan) {
    return { plan: teamPlan, individualOnDemand, teamOnDemand };
  }
  return null;
}

export function extractPoolUsageFromSummary(summaryRaw: unknown): UsagePayload["poolUsage"] {
  const summary = asRecord(summaryRaw);
  if (!summary) return null;
  const blocks = pickUsageBlocks(summary);
  return blocks ? extractPoolUsageFromPlan(blocks.plan) : null;
}

export function extractUsageFromSummary(
  summaryRaw: unknown,
  stripeOnDemandEnabled: boolean,
): UsagePayload | null {
  const summary = asRecord(summaryRaw);
  if (!summary) return null;

  const blocks = pickUsageBlocks(summary);
  if (!blocks) return null;

  const { plan, individualOnDemand, teamOnDemand } = blocks;
  const used = toNumber(plan.used);
  const limit = toNumber(plan.limit);
  const breakdown = asRecord(plan.breakdown);
  const breakdownUsed = toNumber(breakdown?.included) ?? toNumber(breakdown?.total);
  const breakdownLimit = toNumber(breakdown?.total) ?? toNumber(breakdown?.included);

  const resolvedUsed = used ?? breakdownUsed ?? 0;
  const resolvedLimit = limit ?? breakdownLimit ?? 0;
  const poolUsage = extractPoolUsageFromPlan(plan);

  if (resolvedUsed === 0 && resolvedLimit === 0 && !poolUsage) {
    return null;
  }

  const onDemandBlock = individualOnDemand ?? teamOnDemand;
  const onDemand = extractOnDemandFromSummaryBlock(onDemandBlock, stripeOnDemandEnabled);

  const billingCycleEnd = typeof summary.billingCycleEnd === "string" ? summary.billingCycleEnd : null;
  const billingCycleStart = typeof summary.billingCycleStart === "string" ? summary.billingCycleStart : null;
  const resetsAt = billingCycleEnd ?? (billingCycleStart ? nextMonth(billingCycleStart) : null);

  return {
    includedRequests: {
      used: resolvedUsed,
      limit: resolvedLimit,
    },
    includedMetric: "cents",
    onDemand,
    poolUsage,
    resetsAt,
  };
}

export function extractTeamUsedRequests(member: Record<string, unknown>): NumberWithSource {
  return (
    pickNumber(member, [
      "includedRequestsUsed",
      "numRequests",
      "requestsUsed",
      "fastPremiumRequests",
      "fastPremiumRequestsUsed",
      "premiumRequestsUsed",
      "requestCount",
      "includedUsage",
      "overallSpendCents",
      "spendCents",
    ]) ?? { value: 0, source: "fallback:0" }
  );
}

export function extractTeamRequestLimit(
  member: Record<string, unknown>,
  fallbackLimit: number,
): NumberWithSource {
  const dollarLimit = pickNumber(member, [
    "monthlyLimitDollars",
    "effectivePerUserLimitDollars",
  ]);
  if (dollarLimit && dollarLimit.value > 0) {
    return { value: Math.round(dollarLimit.value * 100), source: `${dollarLimit.source}*100` };
  }

  return (
    pickNumber(member, [
      "includedRequestLimit",
      "maxRequestUsage",
      "maxRequests",
      "requestLimit",
      "premiumRequestLimit",
    ]) ?? {
      value: fallbackLimit,
      source: "setup.maxRequestUsage",
    }
  );
}
