import * as vscode from "vscode";
import {
  configure,
  fetchDailySpendByCategory,
  fetchUsageData,
  fetchUsageEvents,
  invalidateAuthCache,
  isTeamMemberCached,
  type DailySpendRow,
  type UsagePayload,
  type UsageEvent,
} from "./cursor-api";
import { DashboardPanel, OPEN_DASHBOARD_COMMAND } from "./dashboard-panel";
import { buildDashboardState, type DashboardState } from "./dashboard-state";
import {
  resolveConfiguredUsageDuration,
} from "./duration-options";
import { formatTokens } from "./format";
import {
  aggregateByModel,
  filterZeroTokenModels,
  formatDollarsFromCents,
  type ModelBreakdownSortBy,
  type SortOrder,
  type UsageDuration,
} from "./model-breakdown";
import {
  buildUsageByModelHeadingMarkdown,
  buildUsageOverviewMarkdown,
  OPEN_DURATION_SETTING_COMMAND,
} from "./tooltip";
import {
  formatIncludedUsage,
  formatMinimalStatusBarUsageText,
  formatStatusBarUsageText,
} from "./usage-display";
import { mergeNewestEvents } from "./usage-events";

let statusBarItem: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let lastData: UsagePayload | null = null;
let lastError: string | null = null;
let lastFetchTime = 0;
let usageInFlight: Promise<void> | null = null;
let eventsSync: Promise<void> | null = null;
let eventsSyncQueued = false;
let eventsRetryLatest = false;
let firstPageWaiters: Array<() => void> = [];
let lastEvents: UsageEvent[] | null = null;
let lastDailySpend: DailySpendRow[] | null = null;
const EVENTS_LATEST_RETRY_MS = 1_500;

const DEBOUNCE_MS = 30_000;

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  outputChannel.appendLine(`[${ts}] ${msg}`);
}

function getConfig() {
  const cfg = vscode.workspace.getConfiguration("cursorUsage");
  const modelBreakdownSortBy = cfg.get<ModelBreakdownSortBy>("modelBreakdownSortBy", "tokens");
  const modelBreakdownSortOrder = cfg.get<SortOrder>("modelBreakdownSortOrder", "desc");
  return {
    pollInterval: cfg.get<number>("pollInterval", 5),
    minimalMode: cfg.get<boolean>("minimalMode", false),
    usageDuration: cfg.get<string>("usageDuration", "billingCycle"),
    modelBreakdownSortBy,
    modelBreakdownSortOrder,
    excludeZeroTokenModels: cfg.get<boolean>("excludeZeroTokenModels", false),
    quotaAwareEventDisplay: cfg.get<boolean>("quotaAwareEventDisplay", true),
  };
}

function getCooldownMs(): number {
  return getConfig().pollInterval * 60_000;
}

function scheduleRefresh() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = undefined;
    if (Date.now() - lastFetchTime >= getCooldownMs()) {
      updateUsage();
    }
  }, DEBOUNCE_MS);
}

function refreshOnFocus(state: vscode.WindowState) {
  if (state.focused && Date.now() - lastFetchTime >= getCooldownMs()) {
    updateUsage();
  }
}

function formatResetDate(iso: string): string {
  const resetDate = new Date(iso);
  const now = new Date();
  const diffMs = resetDate.getTime() - now.getTime();
  const daysLeft = Math.max(0, Math.ceil(diffMs / 86_400_000));
  const formatted = resetDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `in ${daysLeft} day${daysLeft !== 1 ? "s" : ""} on ${formatted}`;
}

function isLightTheme(): boolean {
  const kind = vscode.window.activeColorTheme.kind;
  return kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight;
}

function progressBarDataUri(ratio: number, barWidth = 220): string {
  const clamped = Math.min(Math.max(ratio, 0), 1);
  const width = barWidth;
  const height = 10;
  const r = height / 2;
  const fillWidth = Math.round(clamped * width);

  const light = isLightTheme();
  const trackColor = light ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.18)";
  const fillColor = light ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.82)";

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`;
  svg += `<rect width="${width}" height="${height}" rx="${r}" ry="${r}" fill="${trackColor}"/>`;
  if (fillWidth > 0) {
    svg += `<rect width="${fillWidth}" height="${height}" rx="${r}" ry="${r}" fill="${fillColor}"/>`;
  }
  svg += `</svg>`;

  const encoded = Buffer.from(svg).toString("base64");
  return `data:image/svg+xml;base64,${encoded}`;
}

function progressBarMarkdown(ratio: number, barWidth = 220): string {
  return `![](${progressBarDataUri(ratio, barWidth)})`;
}

function progressBarHtml(ratio: number, barWidth = 220): string {
  return `<img src="${progressBarDataUri(ratio, barWidth)}" width="${barWidth}" height="10" />`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    };
    return entities[char] ?? char;
  });
}

function summaryDividerHtml(height = 52): string {
  const light = isLightTheme();
  const strokeColor = light ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.14)";
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="2" height="${height}" viewBox="0 0 2 ${height}">`,
    `<rect x="0.5" y="0" width="1" height="${height}" fill="${strokeColor}"/>`,
    `</svg>`,
  ].join("");
  const encoded = Buffer.from(svg).toString("base64");
  return `<img src="data:image/svg+xml;base64,${encoded}" width="2" height="${height}" />`;
}

type OnDemandUsage = UsagePayload["onDemand"];

function buildModelBreakdownTableMarkdown(
  rows: Array<{ model: string; totalTokens: number; requests: number; spendCents: number }>,
  tableWidth: number,
): string {
  if (rows.length === 0) {
    return "*No usage in this period*\n\n";
  }

  const lines = [
    `<table width="${tableWidth}" cellspacing="0" cellpadding="0">`,
    `  <tr>`,
    `    <th align="left" width="45%">Model</th>`,
    `    <th align="right" width="15%">Requests</th>`,
    `    <th align="right" width="20%">Tokens</th>`,
    `    <th align="right" width="20%">Spend</th>`,
    `  </tr>`,
  ];

  for (const row of rows) {
    lines.push(
      `  <tr>` +
      `<td align="left">${escapeHtml(row.model)}</td>` +
      `<td align="right">${Math.round(row.requests)}</td>` +
      `<td align="right">${formatTokens(row.totalTokens)}</td>` +
      `<td align="right">${formatDollarsFromCents(row.spendCents)}</td>` +
      `</tr>`,
    );
  }

  lines.push(`</table>`, ``);
  return lines.join("\n");
}

function isOnDemandVisible(onDemand: OnDemandUsage): boolean {
  return onDemand.state !== "disabled";
}

function getOnDemandRatio(onDemand: OnDemandUsage): number | null {
  if (onDemand.state !== "limited") return null;
  if (onDemand.limitDollars === null || onDemand.limitDollars <= 0) return null;
  return onDemand.spendDollars / onDemand.limitDollars;
}

function updateStatusBar(data: UsagePayload) {
  const { minimalMode } = getConfig();

  statusBarItem.text = `$(pulse) ${minimalMode ? formatMinimalStatusBarUsageText(data) : formatStatusBarUsageText(data)}`;

  const tooltip = new vscode.MarkdownString();
  tooltip.isTrusted = {
    enabledCommands: [OPEN_DASHBOARD_COMMAND, "cursor-usage.refresh", OPEN_DURATION_SETTING_COMMAND],
  };
  tooltip.supportThemeIcons = true;
  tooltip.supportHtml = true;

  const barW = 150;
  let md = `### $(pulse) Cursor Usage\n\n`;
  md += buildUsageOverviewMarkdown(
    { includedRequests, onDemand, poolUsage: data.poolUsage, includedMetric: data.includedMetric },
    {
      markdown: (ratio) => progressBarMarkdown(ratio, barW),
      html: (ratio) => progressBarHtml(ratio, barW),
      divider: () => summaryDividerHtml(),
    },
  );
  md += `\n`;

  if (lastEvents && lastEvents.length > 0) {
    const config = getConfig();
    const usageDuration: UsageDuration = resolveConfiguredUsageDuration(config.usageDuration, Boolean(data.resetsAt));
    const models = aggregateByModel(
      lastEvents,
      lastDailySpend ?? [],
      usageDuration,
      data.resetsAt,
      Date.now(),
      config.modelBreakdownSortBy,
      config.modelBreakdownSortOrder,
    );
    const filteredModels = filterZeroTokenModels(models, config.excludeZeroTokenModels);
    md += `<hr>\n\n`;
    md += buildUsageByModelHeadingMarkdown(usageDuration);
    const modelTableWidth = barW * 2 + 2;
    md += buildModelBreakdownTableMarkdown(filteredModels, modelTableWidth);
  }

  if (data.resetsAt) {
    md += `<hr>\n\n`;
    md += `*Resets ${formatResetDate(data.resetsAt)}*\n\n`;
  }

  md += `<hr>\n\n`;
  md += `[Open Dashboard](command:${OPEN_DASHBOARD_COMMAND}) | [Refresh](command:cursor-usage.refresh)`;

  tooltip.appendMarkdown(md);
  statusBarItem.tooltip = tooltip;
}

function applyUsagePayload(data: UsagePayload | null, fetchFailed: boolean): void {
  if (data) {
    lastData = data;
    lastError = null;
    updateStatusBar(data);
    return;
  }

  lastError = "Could not fetch usage data";
  if (!lastData) {
    statusBarItem.text = "$(warning) Usage unavailable";
    statusBarItem.tooltip = "Could not fetch Cursor usage data. Click to see options.";
    return;
  }
  statusBarItem.text = statusBarItem.text.replace("$(loading~spin)", "$(pulse)");
  if (fetchFailed) {
    log("Usage data fetch failed; keeping previously displayed totals");
  }
}

function resolveFirstPageWaiters(): void {
  const waiters = firstPageWaiters;
  firstPageWaiters = [];
  for (const resolve of waiters) resolve();
}

function applyEvents(events: UsageEvent[]): void {
  lastEvents = events;
  DashboardPanel.currentPanel?.postState(getDashboardState());
}

async function runEventsSyncOnce(opts?: { retryLatest?: boolean }): Promise<void> {
  log("Syncing usage events...");
  try {
    const firstPage = await fetchUsageEvents({ maxPages: 1 });
    applyEvents(mergeNewestEvents(lastEvents ?? [], firstPage));
  } catch (error) {
    log(`Latest usage events page failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    resolveFirstPageWaiters();
  }

  if (opts?.retryLatest) {
    await new Promise((resolve) => setTimeout(resolve, EVENTS_LATEST_RETRY_MS));
    try {
      const retryPage = await fetchUsageEvents({ maxPages: 1 });
      applyEvents(mergeNewestEvents(lastEvents ?? [], retryPage));
    } catch (error) {
      log(`Usage events retry failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const [eventsResult, spendResult] = await Promise.allSettled([
    fetchUsageEvents(),
    fetchDailySpendByCategory(),
  ]);

  if (eventsResult.status === "fulfilled") {
    applyEvents(mergeNewestEvents(eventsResult.value, lastEvents ?? []));
  } else {
    log(`Usage events fetch failed: ${eventsResult.reason}`);
  }

  if (spendResult.status === "fulfilled") {
    lastDailySpend = spendResult.value;
    DashboardPanel.currentPanel?.postState(getDashboardState());
  } else {
    log(`Daily spend fetch failed: ${spendResult.reason}`);
  }
}

function syncEventsInBackground(opts?: { retryLatest?: boolean }): { firstPage: Promise<void>; done: Promise<void> } {
  const firstPage = new Promise<void>((resolve) => {
    firstPageWaiters.push(resolve);
  });

  if (opts?.retryLatest) eventsRetryLatest = true;
  eventsSyncQueued = true;
  if (!eventsSync) {
    eventsSync = (async () => {
      try {
        while (eventsSyncQueued) {
          eventsSyncQueued = false;
          const retryLatest = eventsRetryLatest;
          eventsRetryLatest = false;
          await runEventsSyncOnce({ retryLatest });
        }
      } finally {
        resolveFirstPageWaiters();
      }
    })().finally(() => {
      eventsSync = null;
    });
  }

  return { firstPage, done: eventsSync ?? Promise.resolve() };
}

async function updateUsage(opts: { force?: boolean } = {}): Promise<void> {
  const force = opts.force === true;
  if (force) {
    invalidateAuthCache();
  }

  if (usageInFlight) {
    await usageInFlight;
    if (!force) return;
  }

  const run = (async () => {
    statusBarItem.text = statusBarItem.text.replace("$(pulse)", "$(loading~spin)");
    await new Promise((r) => setTimeout(r, 0));

    try {
      log(force ? "--- Forced usage refresh ---" : "--- Fetching usage data ---");
      const data = await fetchUsageData();
      applyUsagePayload(data, data === null);
      lastFetchTime = Date.now();
      DashboardPanel.currentPanel?.postState(getDashboardState());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`Error in updateUsage: ${msg}`);
      lastError = msg;
      if (!lastData) {
        statusBarItem.text = "$(warning) Usage unavailable";
        statusBarItem.tooltip = `Error: ${msg}`;
      } else {
        statusBarItem.text = statusBarItem.text.replace("$(loading~spin)", "$(pulse)");
      }
      lastFetchTime = Date.now();
      DashboardPanel.currentPanel?.postState(getDashboardState());
    }
  })();

  usageInFlight = run.finally(() => {
    if (usageInFlight === run) usageInFlight = null;
  });
  await run;
  const events = syncEventsInBackground({ retryLatest: force });
  if (force) await events.firstPage;
  else void events.done;
}

async function showDetails() {
  if (!lastData) {
    const items: string[] = ["Refresh", "Open Dashboard", "Show Logs"];
    const action = await vscode.window.showWarningMessage(
      lastError
        ? `Cursor usage unavailable: ${lastError}`
        : "Cursor usage data is not available yet.",
      ...items,
    );
    if (action === "Refresh") await updateUsage({ force: true });
    else if (action === "Open Dashboard") await vscode.commands.executeCommand(OPEN_DASHBOARD_COMMAND);
    else if (action === "Show Logs") outputChannel.show();
    return;
  }

  const { includedRequests, onDemand, resetsAt, poolUsage } = lastData;
  const reqPct = includedRequests.limit > 0 ? Math.round((includedRequests.used / includedRequests.limit) * 100) : 0;
  const spendRatio = getOnDemandRatio(onDemand);
  const spendPct = spendRatio === null ? null : Math.round(spendRatio * 100);
  const onDemandVisible = isOnDemandVisible(onDemand);

  let message = poolUsage
    ? `Auto: ${poolUsage.autoPercentUsed.toFixed(1)}% | API: ${poolUsage.apiPercentUsed.toFixed(1)}%`
    : `Included: ${formatIncludedUsage(lastData)} (${reqPct}%)`;
  if (onDemandVisible) {
    const spendText = onDemand.state === "unlimited"
      ? `$${onDemand.spendDollars.toFixed(2)}`
      : `$${onDemand.spendDollars.toFixed(2)}/$${(onDemand.limitDollars ?? 0).toFixed(2)} (${spendPct ?? 0}%)`;
    message += ` | Spend: ${spendText}`;
  }
  if (resetsAt) message += ` | Resets: ${formatResetDate(resetsAt)}`;

  const action = await vscode.window.showInformationMessage(
    message,
    "Open Dashboard",
    "Refresh",
  );

  if (action === "Open Dashboard") {
    await vscode.commands.executeCommand(OPEN_DASHBOARD_COMMAND);
  } else if (action === "Refresh") {
    await updateUsage({ force: true });
  }
}

async function openDurationSetting() {
  await vscode.commands.executeCommand("workbench.action.openSettings", "cursorUsage.usageDuration");
}

function getDashboardState(): DashboardState {
  return buildDashboardState(
    lastData,
    lastEvents ?? [],
    lastDailySpend ?? [],
    isTeamMemberCached(),
    lastError,
    Date.now(),
    getConfig().quotaAwareEventDisplay,
  );
}

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel("Cursor Usage");
  log("Extension activating...");

  configure({ logger: log });

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = OPEN_DASHBOARD_COMMAND;
  statusBarItem.text = "$(loading~spin) Usage";
  statusBarItem.show();

  const showDetailsCmd = vscode.commands.registerCommand("cursor-usage.showDetails", showDetails);
  const refreshFromUser = () => updateUsage({ force: true });
  const refreshCmd = vscode.commands.registerCommand("cursor-usage.refresh", refreshFromUser);
  const openDurationSettingCmd = vscode.commands.registerCommand(OPEN_DURATION_SETTING_COMMAND, openDurationSetting);
  const openDashboardCmd = vscode.commands.registerCommand(OPEN_DASHBOARD_COMMAND, () => {
    DashboardPanel.createOrShow(context, refreshFromUser, getDashboardState);
    DashboardPanel.currentPanel?.postState(getDashboardState());
    void updateUsage({ force: true });
  });

  const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
    if (
      lastData
      && (e.affectsConfiguration("cursorUsage.minimalMode")
        || e.affectsConfiguration("cursorUsage.usageDuration")
        || e.affectsConfiguration("cursorUsage.modelBreakdownSortBy")
        || e.affectsConfiguration("cursorUsage.modelBreakdownSortOrder")
        || e.affectsConfiguration("cursorUsage.excludeZeroTokenModels")
        || e.affectsConfiguration("cursorUsage.quotaAwareEventDisplay"))
    ) {
      updateStatusBar(lastData);
      DashboardPanel.currentPanel?.postState(getDashboardState());
    }
  });

  const docChangeListener = vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document.uri.scheme === "file") {
      scheduleRefresh();
    }
  });

  const focusListener = vscode.window.onDidChangeWindowState(refreshOnFocus);

  const themeListener = vscode.window.onDidChangeActiveColorTheme(() => {
    if (lastData) updateStatusBar(lastData);
  });

  context.subscriptions.push(
    statusBarItem, showDetailsCmd, refreshCmd, openDurationSettingCmd, openDashboardCmd,
    configListener, docChangeListener, focusListener, themeListener,
    outputChannel,
  );

  log("Extension activated, fetching initial usage...");
  updateUsage();
}

export function deactivate() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
  }
}
