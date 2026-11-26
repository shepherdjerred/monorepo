import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { FIXTURE_TRACE_IDS } from "../src/modules/traces/fixtures-data.ts";
import {
  DESKTOP,
  expectPagesFitViewport,
  gotoLoadedPage,
  PHONE,
  violations,
} from "./helpers.ts";

test("navigates to /traces from sidebar and AI page, filters traces, and reconstructs >30d archive-only trace", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/ai");
  await page.getByRole("link", { name: "Explore LLM traces" }).click();
  await expect(page).toHaveURL(/\/traces$/u);
  await expect(page).toHaveTitle("Traces · Hub");
  await expect(
    page.getByRole("heading", { level: 1, name: "Traces" }),
  ).toBeVisible();

  // Navigate via Primary navigation sidebar as well
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Traces" })
    .click();
  await expect(page).toHaveURL(/\/traces$/u);

  // 5 KPI cards
  await expect(page.locator(".eng-kpi-card")).toHaveCount(5);
  await expect(
    page.locator(".eng-kpi-card", { hasText: "Matched traces" }),
  ).toContainText("5");
  await expect(
    page.locator(".eng-kpi-card", { hasText: "Error traces" }),
  ).toContainText("1");
  await expect(
    page.locator(".eng-kpi-card", { hasText: "Archive index" }),
  ).toContainText("6 traces");

  const liveTable = page.getByRole("table", {
    name: "Live Tempo LLM traces",
  });
  await expect(liveTable.locator("tbody tr")).toHaveCount(5);
  await expect(liveTable).not.toContainText("patch-notes-digest");

  // Filter by status = error and service = birmel
  await page.getByLabel("Status").selectOption("error");
  await expect(page).toHaveURL(/status=error/u);
  await expect(liveTable.locator("tbody tr")).toHaveCount(1);
  await expect(liveTable).toContainText("discord-reply");

  await page.getByLabel("Service").selectOption("birmel");
  await expect(liveTable.locator("tbody tr")).toHaveCount(1);

  await page.getByRole("button", { name: "Reset" }).click();
  await expect(liveTable.locator("tbody tr")).toHaveCount(5);

  // Switch to Archive index (365d) tab -> 65-day archive-only trace appears
  await page.getByRole("tab", { name: "Archive index (365d)" }).click();
  await expect(page).toHaveURL(/source=archive/u);
  const archiveTable = page.getByRole("table", {
    name: "SeaweedFS archived LLM traces",
  });
  await expect(archiveTable.locator("tbody tr")).toHaveCount(6);
  await expect(archiveTable).toContainText("patch-notes-digest");

  // Open the 65-day archive-only trace and verify callout banner + reconstructed trajectory
  await archiveTable.getByRole("link", { name: "patch-notes-digest" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/traces/${FIXTURE_TRACE_IDS.archiveOnlyDigest}$`, "u"),
  );
  await expect(
    page.getByRole("region", { name: "Archived trace reconstruction" }),
  ).toContainText("Tempo's 30-day trace retention window has expired");
  await expect(page.locator(".traces-step-card")).toHaveCount(2);
  await expect(page.locator(".traces-step-card").first()).toContainText(
    "Embeddings",
  );
  await expect(page.locator(".traces-step-card").first()).toContainText(
    "4 dimensions",
  );
  await expect(page.locator(".traces-step-card").nth(1)).toContainText(
    "Patch 16.18 shifts mid-lane priority",
  );

  // Back link preserves the Archive index filter query params
  await page.locator("main").getByRole("link", { name: "Traces" }).click();
  await expect(page).toHaveURL(/\/traces\?.*source=archive/u);
});

test("renders specialized trajectory views for AI SDK chat, OpenAI decisions, Claude agent, and Codex agent plus Waterfall and Archive tabs", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);

  // 1. AI SDK chat + Tool Call + Repair + Waterfall + Archive refs
  await gotoLoadedPage(page, `/traces/${FIXTURE_TRACE_IDS.aiSdkChat}`);
  await expect(page.locator(".traces-step-card")).toHaveCount(3);
  await expect(page.getByText("Repair attempt")).toBeVisible();
  await expect(page.getByText("Tool call · fetchMatchTimeline")).toBeVisible();
  await expect(
    page.getByText("Tool result · fetchMatchTimeline"),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Correlated Loki logs/u }),
  ).toHaveAttribute("href", /grafana\.tailnet-1a49\.ts\.net\/explore/u);

  await page.getByRole("tab", { name: "Waterfall" }).click();
  await expect(page).toHaveURL(/tab=waterfall/u);
  const wfRegion = page.getByRole("region", { name: "Span waterfall" });
  await expect(wfRegion.locator("button.traces-wf-row")).toHaveCount(6);
  await wfRegion
    .getByRole("button", { name: /execute_tool fetchMatchTimeline/u })
    .click();
  await expect(
    page.getByRole("region", { name: "Selected span inspector" }),
  ).toContainText("call_timeline_1");

  await page.getByRole("tab", { name: "Archive & attributes" }).click();
  await expect(page).toHaveURL(/tab=archive/u);
  await expect(
    page.getByRole("table", { name: /SeaweedFS archive envelopes/u }),
  ).toContainText("s3://llm-archive/llm/scout-backend/openai/");

  // 2. OpenAI Decisions
  await gotoLoadedPage(page, `/traces/${FIXTURE_TRACE_IDS.openAiDecision}`);
  await expect(page.getByText("OpenAI decision")).toBeVisible();
  await expect(page.getByText("Choice · prismatic")).toBeVisible();
  await expect(page.getByText("Score · 4.30")).toBeVisible();
  await expect(
    page.getByRole("meter", { name: "eligible_for_dare probability" }),
  ).toHaveAttribute("aria-valuenow", "0.91");

  // 3. Claude agent SDK session
  await gotoLoadedPage(page, `/traces/${FIXTURE_TRACE_IDS.claudeAgent}`);
  await expect(page.getByText("Claude agent", { exact: true })).toBeVisible();
  await expect(
    page.getByText("session: sess_claude_01J9PR5041", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("4 turns", { exact: true })).toBeVisible();
  await expect(
    page.locator(".eng-kpi-card", { hasText: "Cost & attribution" }),
  ).toContainText("Subscription est. $0.18");
  await expect(
    page.getByRole("link", { name: /Temporal workflow/u }),
  ).toHaveAttribute(
    "href",
    /temporal-ui\.tailnet-1a49\.ts\.net\/namespaces\/prod\/workflows\/pr-remediation-5041/u,
  );

  // 4. Codex agent SDK command execution
  await gotoLoadedPage(page, `/traces/${FIXTURE_TRACE_IDS.codexAgent}`);
  await expect(page.getByText("Codex agent", { exact: true })).toBeVisible();
  await expect(page.getByText("pokemon-ctl state --json")).toBeVisible();
  await expect(page.getByText("exit 0", { exact: true })).toBeVisible();
  await expect(page.getByText("pokemon-ctl walk --to 40,18")).toBeVisible();
  await expect(page.getByText("exit 1", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/path blocked by one-way ledge tile/u),
  ).toBeVisible();
});

test("command palette (⌘K) supports direct 32-hex traceId jump", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await expect(page.locator("main h1")).toHaveText("Home");

  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Search and commands" });
  await expect(palette).toBeVisible();

  const targetId = FIXTURE_TRACE_IDS.openAiDecision;
  await palette.getByRole("combobox").fill(targetId);
  const directJump = palette
    .getByRole("group", { name: "Traces" })
    .getByRole("option", { name: `Open trace ${targetId.slice(0, 12)}…` });
  await expect(directJump).toBeVisible();
  await page.keyboard.press("Enter");

  await expect(palette).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/traces/${targetId}$`, "u"));
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "runtime.decide dare-eligibility",
    }),
  ).toBeVisible();
});

const TRACE_PATHS = [
  "/traces",
  "/traces?source=archive&range=365d",
  `/traces/${FIXTURE_TRACE_IDS.aiSdkChat}`,
  `/traces/${FIXTURE_TRACE_IDS.aiSdkChat}?tab=waterfall`,
  `/traces/${FIXTURE_TRACE_IDS.aiSdkChat}?tab=archive`,
  `/traces/${FIXTURE_TRACE_IDS.openAiDecision}`,
  `/traces/${FIXTURE_TRACE_IDS.claudeAgent}`,
  `/traces/${FIXTURE_TRACE_IDS.codexAgent}`,
  `/traces/${FIXTURE_TRACE_IDS.erroredBirmel}`,
  `/traces/${FIXTURE_TRACE_IDS.archiveOnlyDigest}`,
] as const;

for (const viewport of [PHONE, DESKTOP]) {
  test(`Traces pages fit ${String(viewport.width)}px without horizontal overflow`, async ({
    page,
  }) => {
    await expectPagesFitViewport(page, viewport, TRACE_PATHS);
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`Traces pages have zero axe-core WCAG 2.2 AA violations in ${colorScheme} mode`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize(DESKTOP);
    for (const path of TRACE_PATHS) {
      await gotoLoadedPage(page, path);
      expect(await violations(new AxeBuilder({ page })), path).toEqual([]);
    }
  });
}
