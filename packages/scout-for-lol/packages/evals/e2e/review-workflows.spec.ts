import {
  expect,
  test as base,
  type Locator,
  type Page,
} from "@playwright/test";

const BASE_ORIGIN = "http://127.0.0.1:7351";

const test = base.extend<{ browserGuard: boolean }>({
  browserGuard: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on("console", (message) => {
        if (
          message.type() === "error" &&
          !message.text().startsWith("Failed to load resource:")
        ) {
          problems.push(message.text());
        }
      });
      page.on("pageerror", (error) => {
        problems.push(error.message);
      });
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (url.origin !== BASE_ORIGIN) {
          problems.push(`Unexpected external request: ${request.url()}`);
        }
      });
      await use(true);
      expect(problems).toEqual([]);
    },
    { auto: true },
  ],
});

function datasetCard(page: Page, name: string): Locator {
  return page.locator('[data-slot="card"]').filter({ hasText: name }).first();
}

async function openDataset(page: Page, name: string): Promise<void> {
  await page.goto("/");
  const card = datasetCard(page, name);
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Open" }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
}

async function selectScore(
  page: Page,
  legend: string,
  scoreLabel: string,
): Promise<void> {
  const group = page.getByRole("group", { name: legend });
  const option = group.locator("label").filter({ hasText: scoreLabel });
  const radio = option.getByRole("radio");
  await option.click();
  await expect(radio).toBeChecked();
}

async function openStyleBatch(
  page: Page,
  datasetName: string,
  styleKey: string,
): Promise<void> {
  await expect(
    page.getByRole("heading", { name: datasetName, level: 1 }),
  ).toBeVisible();
  await page.getByRole("button", { name: styleKey }).click();
}

test("creates an empty draft and validates local form input", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Datasets | Scout Review Evals");

  await page.getByLabel("Dataset name").fill(" ".repeat(3));
  await page.getByLabel("Stable key").fill(" ".repeat(3));
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL("/");

  await page.getByLabel("Dataset name").fill("Created Through Browser");
  await page.getByLabel("Stable key").fill("browser-created");
  await page
    .getByLabel("Description")
    .fill("Created through the complete browser and tRPC path.");
  await page.getByRole("button", { name: "Create draft" }).click();

  await expect(
    page.getByRole("heading", { name: "Created Through Browser", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByText("This draft has no materialized cases yet."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Finalize dataset" }),
  ).toBeDisabled();

  const datasetId = new URL(page.url()).pathname.split("/").at(-1);
  if (datasetId === undefined || datasetId === "") {
    throw new Error("Created draft URL did not contain a dataset ID");
  }
  await expect(page.getByLabel("Materialization target")).toHaveText(
    JSON.stringify({ datasetId }, null, 2),
  );

  const materializationResponse = await page.request.post(
    `/e2e/materialize/${encodeURIComponent(datasetId)}`,
  );
  expect(materializationResponse.status()).toBe(200);
  expect(await materializationResponse.json()).toEqual({
    datasetId,
    caseIds: [expect.any(String)],
  });

  await page.reload();
  await expect(page.getByText("Draft Player on Taliyah")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Finalize dataset" }),
  ).toBeEnabled();
});

test("finalizes populated membership and persists the result", async ({
  page,
}) => {
  await openDataset(page, "Finalization Candidate");
  await expect(page.getByText("draft", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Finalize dataset" }).click();
  await expect(page.getByText("finalized", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Finalize dataset" }),
  ).toHaveCount(0);

  await page.reload();
  await expect(page.getByText("finalized", { exact: true })).toBeVisible();
  await expect(page).toHaveTitle("Finalization Candidate | Scout Review Evals");
});

test("shows every frozen prompt stage in case context", async ({ page }) => {
  await openDataset(page, "Rating Workflow");
  await page.getByRole("button", { name: "Resume rating" }).click();

  const promptLabels = page
    .locator(".evidence-panel > summary")
    .filter({ hasText: "prompt" });
  await expect(promptLabels).toHaveText([
    "Match summary system prompt",
    "Match summary user prompt",
    "Timeline chunk 1 (0:00 - 10:00) system prompt",
    "Timeline chunk 1 (0:00 - 10:00) user prompt",
    "Timeline chunk 2 (10:00 - 20:00) system prompt",
    "Timeline chunk 2 (10:00 - 20:00) user prompt",
    "Timeline aggregate system prompt",
    "Timeline aggregate user prompt",
    "Final review system prompt",
    "Final review user prompt",
  ]);

  await page.getByText("Match summary system prompt", { exact: true }).click();
  await expect(page.getByText("Summarize the match.")).toBeVisible();
  await page
    .getByText("Timeline chunk 2 (10:00 - 20:00) user prompt", { exact: true })
    .click();
  await expect(page.getByText("Closing timeline events.")).toBeVisible();
  await page
    .getByText("Timeline aggregate user prompt", { exact: true })
    .click();
  await expect(page.getByText("Combine the ordered summaries.")).toBeVisible();
  await page.getByText("Final review user prompt", { exact: true }).click();
  await expect(page.getByText("Review this match.")).toBeVisible();
});

test("rates cases, navigates, and reloads persisted calibration", async ({
  page,
}) => {
  await openDataset(page, "Rating Workflow");
  await page.getByRole("button", { name: "Resume rating" }).click();
  await expect(
    page.getByRole("heading", { name: "Jerred on Poppy", level: 1 }),
  ).toBeVisible();
  await expect(page).toHaveTitle("Jerred review | Scout Review Evals");
  await page.reload();
  await expect(
    page.getByText("Jerred turned every wall into a Poppy delivery address."),
  ).toBeVisible();

  await page.getByText("Deterministic match facts", { exact: true }).click();
  await expect(page.getByText("Jerred went 10/1/8")).toBeVisible();
  const overallScore = page.getByLabel("Overall score");
  await expect(overallScore).toHaveText("Select all three scores");
  await selectScore(page, "Anchoredness", "Great");
  await selectScore(page, "Entertainment", "Okay");
  await selectScore(page, "Style recognizability", "Great");
  await expect(overallScore).toHaveText("2.67 / 3");
  const note = page.getByLabel("Optional note");
  await expect(note).toHaveAttribute("maxlength", "2000");
  await note.fill("Specific to the wall-stun pattern.");
  await page.getByRole("button", { name: "Save and next" }).click();

  await expect(
    page.getByRole("heading", { name: "Ryan on Shaco", level: 1 }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Jerred on Poppy", level: 1 }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("group", { name: "Anchoredness" })
      .getByRole("radio", { name: /3 Great/ }),
  ).toBeChecked();
  await expect(page.getByLabel("Optional note")).toHaveValue(
    "Specific to the wall-stun pattern.",
  );
  await expect(page.getByLabel("Overall score")).toHaveText("2.67 / 3");
  await page.goForward();

  await selectScore(page, "Anchoredness", "Bad");
  await selectScore(page, "Entertainment", "Okay");
  await selectScore(page, "Style recognizability", "Okay");
  await expect(page.getByLabel("Overall score")).toHaveText("1.67 / 3");
  await page.getByRole("button", { name: "Save and next" }).click();
  await expect(
    page.getByRole("heading", { name: "Rating Workflow", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume rating" })).toHaveCount(
    0,
  );
  await expect(
    page
      .locator('[data-slot="card"]')
      .filter({ hasText: "Calibration progress" }),
  ).toContainText("2of 2");
});

test("rates freshness using latest generations and preserves the score", async ({
  page,
}) => {
  await openDataset(page, "Freshness Workflow");
  await expect(
    page.getByText(
      "Complete 2 more individual ratings to unlock batch freshness.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "nekoryan" })).toHaveCount(0);
  const datasetUrl = page.url();
  await page.goto(`${datasetUrl}/freshness/nekoryan`);
  await expect(page.getByText("Freshness batch not found.")).toBeVisible();

  await page.goto(datasetUrl);
  await page.getByRole("button", { name: "Resume rating" }).click();
  await selectScore(page, "Anchoredness", "Great");
  await selectScore(page, "Entertainment", "Great");
  await selectScore(page, "Style recognizability", "Okay");
  await page.getByRole("button", { name: "Save and next" }).click();
  await page.getByRole("button", { name: "Dataset" }).click();
  await expect(
    page.getByText(
      "Complete 1 more individual rating to unlock batch freshness.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "nekoryan" })).toHaveCount(0);

  await page.getByRole("button", { name: "Resume rating" }).click();
  await selectScore(page, "Anchoredness", "Okay");
  await selectScore(page, "Entertainment", "Great");
  await selectScore(page, "Style recognizability", "Great");
  await page.getByRole("button", { name: "Save and next" }).click();
  await openStyleBatch(page, "Freshness Workflow", "nekoryan");
  await expect(page).toHaveTitle("nekoryan freshness | Scout Review Evals");
  await expect(
    page.getByText("Colin made Cataclysm the enemy team's permanent address."),
  ).toBeVisible();
  await expect(
    page.getByText("Aaron counted to four and then invoiced the enemy team."),
  ).toBeVisible();
  await expect(
    page.getByText("Obsolete generation must stay hidden."),
  ).toHaveCount(0);

  await selectScore(page, "Across this batch", "Okay");
  const note = page.getByLabel("Optional note");
  await expect(note).toHaveAttribute("maxlength", "2000");
  await note.fill("Distinct openings, but both close with enemy-team framing.");
  await page.getByRole("button", { name: "Save freshness" }).click();
  await openStyleBatch(page, "Freshness Workflow", "nekoryan");
  await expect(
    page
      .getByRole("group", { name: "Across this batch" })
      .getByRole("radio", { name: /2 Okay/ }),
  ).toBeChecked();
  await expect(page.getByLabel("Optional note")).toHaveValue(
    "Distinct openings, but both close with enemy-team framing.",
  );
});

test("serves deep links and rejects mismatched dataset-case URLs", async ({
  page,
}) => {
  await openDataset(page, "Rating Workflow");
  const caseLink = page.getByRole("link", { name: /Jerred on Poppy/ });
  const casePath = await caseLink.getAttribute("href");
  if (casePath === null) throw new Error("Rating case has no href");
  await page.goto(casePath);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Jerred on Poppy", level: 1 }),
  ).toBeVisible();

  const caseId = new URL(casePath, BASE_ORIGIN).pathname.split("/").at(-1);
  if (caseId === undefined) throw new Error("Rating case URL has no case id");
  await openDataset(page, "Freshness Workflow");
  const freshnessDatasetUrl = page.url();
  await page.goto(`${freshnessDatasetUrl}/cases/${caseId}`);
  await expect(page.getByText("Case not found.")).toBeVisible();
  await expect(page.getByText("Jerred on Poppy")).toHaveCount(0);

  await page.goto(`${freshnessDatasetUrl}/freshness/missing-style`);
  await expect(page.getByText("Freshness batch not found.")).toBeVisible();

  await page.goto("/datasets/missing-dataset");
  await expect(page.getByText("Dataset not found.")).toBeVisible();

  await page.goto("/not-a-real-route");
  await expect(
    page.getByRole("heading", { name: "Page not found", level: 1 }),
  ).toBeVisible();
});

test("keeps score controls ahead of evidence on a narrow viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDataset(page, "Mobile Layout");
  await page.getByRole("link", { name: /Mobile Player on Braum/ }).click();

  const generatedReview = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Generated review" });
  const scorecard = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Human scorecard" });
  const context = page.getByRole("heading", { name: "Context", level: 2 });
  const reviewBox = await generatedReview.boundingBox();
  const scoreBox = await scorecard.boundingBox();
  const contextBox = await context.boundingBox();
  if (reviewBox === null || scoreBox === null || contextBox === null) {
    throw new Error("Mobile case sections are not laid out");
  }
  expect(scoreBox.y).toBeGreaterThan(reviewBox.y);
  expect(contextBox.y).toBeGreaterThan(scoreBox.y);
  const caseWidths = await page.evaluate(() => ({
    client: globalThis.document.documentElement.clientWidth,
    scroll: globalThis.document.documentElement.scrollWidth,
  }));
  expect(caseWidths.scroll).toBe(caseWidths.client);

  await page.getByRole("button", { name: "Dataset" }).click();
  await page.getByRole("button", { name: "aaron" }).click();
  const freshnessScore = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Freshness score" });
  const firstReview = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Mobile Player on Braum" });
  const freshnessScoreBox = await freshnessScore.boundingBox();
  const firstReviewBox = await firstReview.boundingBox();
  if (freshnessScoreBox === null || firstReviewBox === null) {
    throw new Error("Mobile freshness sections are not laid out");
  }
  expect(firstReviewBox.y).toBeGreaterThan(freshnessScoreBox.y);
  const freshnessWidths = await page.evaluate(() => ({
    client: globalThis.document.documentElement.clientWidth,
    scroll: globalThis.document.documentElement.scrollWidth,
  }));
  expect(freshnessWidths.scroll).toBe(freshnessWidths.client);
});
