import { expect, test, type Page } from "@playwright/test";
import { CreateDeploymentV2Schema } from "#shared/deployment-request-contract.ts";
import { DeploymentPageSchema } from "#shared/hub/hub-contract.ts";
import { api, confirm, expectNoHorizontalOverflow } from "./helpers.ts";
import { refuseDeploymentRequest, showIdle } from "./model-environment.ts";

// Served by e2e/model-server.ts. Arcade production waits on an override
// approval, Arcade beta is locked by a recovery-required deploy, and the
// Cloudflare stack's saved plan waits for its decision.
const PROD = "arcade/prod";
const BETA = "arcade/beta";

/** The newest deployment of an environment that matches. */
async function deploymentOf(
  page: Page,
  environmentId: string,
  match: (item: { status: string; recoveryRequired: boolean }) => boolean,
) {
  const { items } = await api(
    page,
    `/api/v1/deployments?environmentId=${encodeURIComponent(environmentId)}`,
    DeploymentPageSchema,
  );
  const found = items.find((item) => match(item));
  if (found === undefined)
    throw new Error(`seeded ${environmentId} deployment`);
  return found.id;
}

async function open(page: Page, environmentId: string) {
  await page.goto(`/environments/${environmentId}`);
  await expect(
    page.getByRole("heading", { level: 1, name: environmentId }),
  ).toBeVisible();
  return page.getByRole("main");
}

const ROLLBACK_BUTTONS = /^(Roll back to this|Re-assert this selection)$/u;

test("a locked environment says recovery is required and refuses every request", async ({
  page,
}) => {
  const locker = await deploymentOf(
    page,
    BETA,
    (item) => item.recoveryRequired,
  );
  const main = await open(page, BETA);
  const header = main.locator(".page-header");
  await expect(header).toContainText("Recovery required");
  await expect(header).not.toContainText("In flight");
  const notice = main.locator(".environment-notice");
  await expect(notice).toHaveClass(/notice error/u);
  await expect(notice).toContainText("failed and this environment is locked.");
  await expect(notice).toContainText(
    "A change may still be running outside Delivery.",
  );
  await expect(notice.getByRole("link", { name: locker })).toHaveAttribute(
    "href",
    `/deployments/${locker}`,
  );
  const request = main.getByRole("button", { name: "Request deployment" });
  await expect(request).toBeDisabled();
  await expect(request).toHaveAccessibleDescription(
    /failed and needs recovery, so this environment is locked/u,
  );
  const rollbacks = main
    .getByRole("region", { name: "Rollback candidates" })
    .getByRole("button", { name: ROLLBACK_BUTTONS });
  expect(await rollbacks.count()).toBeGreaterThan(0);
  for (const button of await rollbacks.all())
    await expect(button).toBeDisabled();
  await expectNoHorizontalOverflow(page);
});

test("a deployment awaiting approval disables every request with a reason that links it", async ({
  page,
}) => {
  const waiting = await deploymentOf(
    page,
    PROD,
    (item) => item.status === "awaiting_approval",
  );
  const main = await open(page, PROD);
  const form = main.getByRole("region", { name: "Request a release" });
  const request = form.getByRole("button", { name: "Request deployment" });
  await expect(request).toBeDisabled();
  await expect(request).toHaveAccessibleDescription(
    /is awaiting approval\. Requests are refused until it finishes or is canceled\./u,
  );
  await expect(form.getByRole("link", { name: waiting })).toHaveAttribute(
    "href",
    `/deployments/${waiting}`,
  );
  const rollback = main.getByRole("region", { name: "Rollback candidates" });
  for (const button of await rollback
    .getByRole("button", { name: ROLLBACK_BUTTONS })
    .all())
    await expect(button).toBeDisabled();
  await expect(rollback.getByRole("link", { name: waiting })).toBeVisible();
  await expect(
    main
      .getByRole("region", { name: "Selection", exact: true })
      .getByRole("button", { name: "Rebind" }),
  ).toBeDisabled();
});

test("a saved plan waiting for its decision reads as awaiting plan approval", async ({
  page,
}) => {
  const main = await open(page, "tofu-cloudflare/prod");
  const header = main.locator(".page-header");
  await expect(header).toContainText(/In flight: \S.* awaiting plan approval/u);
  await expect(header).not.toContainText("running");
  await expect(main.locator(".environment-notice")).toContainText(
    "is awaiting plan approval.",
  );
});

test("the release form keeps its choice after a refusal and offers the override with the server's reason", async ({
  page,
}) => {
  await showIdle(page, PROD);
  const main = await open(page, PROD);
  const form = main.getByRole("region", { name: "Request a release" });
  const version = form.getByRole("combobox", { name: "Version set" });
  // A version reads as its revision, its commit and its age, never its id.
  for (const label of await version.locator("option").allTextContents())
    expect(label).toMatch(/^(Choose a version set|r\d+ · [0-9a-f]{7} · .+)$/u);
  // Beta accepted r3, so an ordinary deploy of it needs no override.
  const chosen = await version
    .locator("option", { hasText: /^r3 · / })
    .getAttribute("value");
  if (chosen === null) throw new Error("r3 is listed");
  await version.selectOption(chosen);
  const override = form.getByRole("checkbox", {
    name: "Ask for an override approval",
  });
  await expect(override).toHaveCount(0);
  const refusal =
    "Set revision is not eligible: arcade/beta has not settled its acceptance; a deploy may ask for an override approval";
  await refuseDeploymentRequest(page, 400, {
    code: "INVALID",
    message: refusal,
  });
  await form.getByRole("button", { name: "Request deployment" }).click();
  const alert = form.getByRole("alert");
  await expect(alert).toHaveText(refusal);
  await expect(alert).not.toContainText("INVALID");
  // The choice survives the refusal, and the error belongs to it.
  await expect(version).toHaveValue(chosen);
  await expect(version).toHaveAttribute("aria-invalid", "true");
  await expect(version).toHaveAccessibleDescription(refusal);
  await expect(override).toBeVisible();
  await expect(override).toHaveAccessibleDescription(
    `${refusal} An override sends it to a human, who may admit it anyway.`,
  );
  await override.check();
  const sent = Promise.withResolvers<unknown>();
  await page.route("**/api/v1/deployments", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    sent.resolve(route.request().postDataJSON());
    return route.abort("failed");
  });
  await form.getByRole("button", { name: "Request deployment" }).click();
  expect(CreateDeploymentV2Schema.parse(await sent.promise)).toMatchObject({
    kind: "deploy",
    versionSetRevisionId: chosen,
    override: true,
  });
});

test("the release form shows the hold, folds digests away and refuses a promotion that changes nothing", async ({
  page,
}) => {
  await showIdle(page, PROD);
  const main = await open(page, PROD);
  const form = main.getByRole("region", { name: "Request a release" });
  await expect(form).toContainText(
    "An alarm fired on the accepted release and the environment is held for an operator.",
  );
  const version = form.getByRole("combobox", { name: "Version set" });
  const older = await version
    .locator("option", { hasText: /^r2 · / })
    .getAttribute("value");
  if (older === null) throw new Error("r2 is listed");
  await version.selectOption(older);
  await expect(
    form.getByRole("heading", { name: "Component changes" }),
  ).toBeVisible();
  await expect(form.getByText("1.2.0").first()).toBeVisible();
  const digests = form.locator("details", { hasText: "Digests" });
  await expect(digests.locator("summary")).toHaveText(/^Digests\s*2$/u);
  await expect(digests.getByText(/^sha256:/u).first()).toBeHidden();
  // Beta's accepted release is already accepted here.
  await form.getByRole("combobox", { name: "Action" }).selectOption("promote");
  const request = form.getByRole("button", { name: "Request deployment" });
  await expect(request).toBeDisabled();
  await expect(request).toHaveAccessibleDescription(
    "r3 is already accepted here, so promoting it from arcade/beta would change nothing.",
  );
  await expectNoHorizontalOverflow(page);
});

test("a rollback refused by a race names the deployment in the way, without its code", async ({
  page,
}) => {
  const waiting = await deploymentOf(
    page,
    PROD,
    (item) => item.status === "awaiting_approval",
  );
  const restore = await showIdle(page, PROD);
  const main = await open(page, PROD);
  // Another request arrives between the read and the press.
  await restore();
  await refuseDeploymentRequest(page, 409, {
    code: "CONFLICT",
    message:
      "Environment already has a pending deployment; cancel it before selecting another revision",
  });
  const region = main.getByRole("region", { name: "Rollback candidates" });
  await region
    .getByRole("listitem")
    .nth(1)
    .getByRole("button", { name: "Roll back to this" })
    .click();
  await confirm(page, "Request rollback");
  const alert = region.getByRole("alert");
  await expect(alert).toContainText(
    "Environment already has a pending deployment; cancel it before selecting another revision",
  );
  await expect(alert).not.toContainText("CONFLICT");
  await expect(alert.getByRole("link", { name: waiting })).toHaveAttribute(
    "href",
    `/deployments/${waiting}`,
  );
});

test("an environment with nothing published or accepted says so", async ({
  page,
}) => {
  const main = await open(page, "delivery/prod");
  const form = main.getByRole("region", { name: "Request a release" });
  await expect(form).toContainText("has been published yet");
  await expect(
    form.getByRole("link", { name: "its pipeline" }),
  ).toHaveAttribute("href", "/pipelines/delivery");
  await expect(
    form.getByRole("button", { name: "Request deployment" }),
  ).toBeDisabled();
  await expect(
    main.getByRole("region", { name: "Monitor", exact: true }),
  ).not.toContainText("settled on acceptance");
});
