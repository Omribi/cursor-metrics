import type { UsagePayload } from "./cursor-api";
import { formatCentsAsDollars, formatPercent } from "./format";

function isOnDemandVisible(onDemand: UsagePayload["onDemand"]): boolean {
  return onDemand.state !== "disabled";
}

function formatOnDemandStatus(onDemand: UsagePayload["onDemand"]): string {
  if (onDemand.state === "unlimited") {
    return `$${onDemand.spendDollars.toFixed(2)}`;
  }
  return `$${onDemand.spendDollars.toFixed(2)}/$${(onDemand.limitDollars ?? 0).toFixed(2)}`;
}

export function formatIncludedUsage(data: Pick<UsagePayload, "includedRequests" | "includedMetric">): string {
  const { used, limit } = data.includedRequests;
  if (data.includedMetric === "cents") {
    return `${formatCentsAsDollars(used)}/${formatCentsAsDollars(limit)}`;
  }
  return `${used}/${limit}`;
}

export function formatIncludedUsageSpaced(
  data: Pick<UsagePayload, "includedRequests" | "includedMetric">,
): string {
  const { used, limit } = data.includedRequests;
  if (data.includedMetric === "cents") {
    return `${formatCentsAsDollars(used)} / ${formatCentsAsDollars(limit)}`;
  }
  return `${used} / ${limit}`;
}

function hasIncludedUsage(data: Pick<UsagePayload, "includedRequests">): boolean {
  return data.includedRequests.limit > 0 || data.includedRequests.used > 0;
}

export function formatStatusBarUsageText(data: UsagePayload): string {
  const parts: string[] = [];

  if (hasIncludedUsage(data)) {
    parts.push(formatIncludedUsage(data));
  } else if (data.poolUsage) {
    parts.push(`${formatPercent(data.poolUsage.autoPercentUsed)}% Auto`);
    parts.push(`${formatPercent(data.poolUsage.apiPercentUsed)}% API`);
  } else {
    parts.push(formatIncludedUsage(data));
  }

  if (isOnDemandVisible(data.onDemand)) {
    parts.push(formatOnDemandStatus(data.onDemand));
  }

  return parts.join(" | ");
}

export function formatMinimalStatusBarUsageText(data: UsagePayload): string {
  const includedExhausted =
    data.includedRequests.limit > 0 && data.includedRequests.used >= data.includedRequests.limit;
  const poolExhausted = (data.poolUsage?.totalPercentUsed ?? 0) >= 100;
  if ((includedExhausted || poolExhausted) && isOnDemandVisible(data.onDemand)) {
    return formatOnDemandStatus(data.onDemand);
  }
  if (hasIncludedUsage(data)) {
    return formatIncludedUsage(data);
  }
  if (data.poolUsage) {
    return `${formatPercent(data.poolUsage.totalPercentUsed)}% used`;
  }
  return formatIncludedUsage(data);
}
