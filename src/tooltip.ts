import type { UsagePayload } from "./cursor-api";
import { getDurationLabel } from "./duration-options";
import { formatPercent } from "./format";
import type { UsageDuration } from "./model-breakdown";
import { formatIncludedUsageSpaced } from "./usage-display";

type IncludedRequestsUsage = UsagePayload["includedRequests"];
type OnDemandUsage = UsagePayload["onDemand"];
type PoolUsage = NonNullable<UsagePayload["poolUsage"]>;

type ProgressBarRenderer = {
  markdown: (ratio: number) => string;
  html: (ratio: number) => string;
  divider: () => string;
};

export const OPEN_DURATION_SETTING_COMMAND = "cursor-usage.openDurationSetting";

function getOnDemandRatio(onDemand: OnDemandUsage): number | null {
  if (onDemand.state !== "limited") return null;
  if (onDemand.limitDollars === null || onDemand.limitDollars <= 0) return null;
  return onDemand.spendDollars / onDemand.limitDollars;
}

type SummaryColumn = {
  label: string;
  value: string;
  footer: string;
};

function formatIncludedValue(
  includedRequests: IncludedRequestsUsage,
  includedMetric: UsagePayload["includedMetric"],
): string {
  return formatIncludedUsageSpaced({ includedRequests, includedMetric });
}

function formatOnDemandValue(onDemand: OnDemandUsage): string {
  if (onDemand.state === "unlimited") {
    return `$${onDemand.spendDollars.toFixed(2)}`;
  }
  return `$${onDemand.spendDollars.toFixed(2)} / $${(onDemand.limitDollars ?? 0).toFixed(2)}`;
}

function buildSummaryTable(columns: SummaryColumn[], renderProgressBar: ProgressBarRenderer): string {
  if (columns.length === 1) {
    return [
      `<table width="100%" cellspacing="0" cellpadding="0">`,
      `  <tr><td width="100%"><sub>${columns[0]!.label}</sub></td></tr>`,
      `  <tr><td><strong>${columns[0]!.value}</strong></td></tr>`,
      `  <tr><td>${columns[0]!.footer}</td></tr>`,
      `</table>`,
      ``,
    ].join("\n");
  }

  return [
    `<table width="100%" cellspacing="0" cellpadding="0">`,
    `  <tr><td><sub>${columns[0]!.label}</sub></td><td width="2%" rowspan="3" valign="top">${renderProgressBar.divider()}</td><td><sub>${columns[1]!.label}</sub></td></tr>`,
    `  <tr><td><strong>${columns[0]!.value}</strong></td><td><strong>${columns[1]!.value}</strong></td></tr>`,
    `  <tr><td>${columns[0]!.footer}</td><td>${columns[1]!.footer}</td></tr>`,
    `</table>`,
    ``,
  ].join("\n");
}

function buildPoolColumns(poolUsage: PoolUsage, renderProgressBar: ProgressBarRenderer): SummaryColumn[] {
  return [
    {
      label: "Auto",
      value: `${formatPercent(poolUsage.autoPercentUsed)}%`,
      footer: renderProgressBar.html(Math.min(Math.max(poolUsage.autoPercentUsed / 100, 0), 1)),
    },
    {
      label: "API",
      value: `${formatPercent(poolUsage.apiPercentUsed)}%`,
      footer: renderProgressBar.html(Math.min(Math.max(poolUsage.apiPercentUsed / 100, 0), 1)),
    },
  ];
}

function buildSummaryColumns(
  includedRequests: IncludedRequestsUsage,
  onDemand: OnDemandUsage,
  renderProgressBar: ProgressBarRenderer,
  includedMetric: UsagePayload["includedMetric"],
): SummaryColumn[] {
  const reqRatio = includedRequests.limit > 0 ? includedRequests.used / includedRequests.limit : 0;
  const includedColumn: SummaryColumn = {
    label: "Included",
    value: formatIncludedValue(includedRequests, includedMetric),
    footer: renderProgressBar.html(reqRatio),
  };

  if (onDemand.state === "disabled") {
    return [includedColumn];
  }

  if (onDemand.state === "unlimited") {
    return [
      includedColumn,
      {
        label: "On-demand",
        value: formatOnDemandValue(onDemand),
        footer: "<sub>Unlimited</sub>",
      },
    ];
  }

  const spendRatio = getOnDemandRatio(onDemand);

  return [
    includedColumn,
    {
      label: "On-demand",
      value: formatOnDemandValue(onDemand),
      footer: spendRatio === null ? "<sub>Spend unavailable</sub>" : renderProgressBar.html(spendRatio),
    },
  ];
}

export function buildUsageOverviewMarkdown(
  data: Pick<UsagePayload, "includedRequests" | "onDemand"> & Partial<Pick<UsagePayload, "poolUsage" | "includedMetric">>,
  renderProgressBar: ProgressBarRenderer,
): string {
  const { includedRequests, onDemand, poolUsage, includedMetric } = data;
  if (poolUsage) {
    return buildSummaryTable(buildPoolColumns(poolUsage, renderProgressBar), renderProgressBar);
  }
  return buildSummaryTable(
    buildSummaryColumns(includedRequests, onDemand, renderProgressBar, includedMetric),
    renderProgressBar,
  );
}

export function buildUsageByModelHeadingMarkdown(duration: UsageDuration): string {
  return `**Usage by Model** *(${getDurationLabel(duration)})* &nbsp;[Change](command:${OPEN_DURATION_SETTING_COMMAND})\n\n`;
}
