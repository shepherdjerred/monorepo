import { expect, test, type Page } from "@playwright/test";
import { DeploymentPageSchema } from "#shared/hub/hub-contract.ts";
import { api, expectNoHorizontalOverflow } from "./helpers.ts";
import {
  APPLIED_REQUEST,
  HELD_PROD,
  RECOVERY_PROD,
  REFUSAL,
  REFUSED_REQUEST,
  SUPERSEDED_REQUEST,
} from "./model-recovery.ts";

// Served by e2e/model-server.ts: Streambot prod accepted r3 after r2 failed,
// then r4 failed twice in a row, the second time with its sync outliving the
// executor until recovery read it back as Succeeded. ArgoCD reports r4's
// image running, and nothing accepted r4.

async function deploymentId(
  page: Page,
  requestId: string,
  environmentId = RECOVERY_PROD,
) {
  const { items } = await api(
    page,
    `/api/v1/deployments?environmentId=${encodeURIComponent(environmentId)}`,
    DeploymentPageSchema,
  );
  const found = items.find((item) => item.requestId === requestId);
  if (found === undefined) throw new Error(`seeded ${requestId}`);
  return found.id;
}

test("every page states what recovery read back, never the executor's stale words", async ({
  page,
}) => {
  await page.goto("/");
  const attention = page.getByRole("region", { name: "Needs attention" });
  const failing = attention
    .getByRole("listitem")
    .filter({ hasText: "prod is failing repeatedly" });
  // A readback of Succeeded is never the reason: the step the deployment ended on is.
  await expect(failing).toContainText(
    "The last 2 deployments failed, the newest with: Step step-sync was still running when the deployment ended. Nothing newer is queued.",
  );
  await expect(failing).not.toContainText("phase Succeeded");
  await expect(attention).not.toContainText("may still be active");

  await page.goto("/pipelines");
  await expect(page.getByRole("main")).toContainText("is failing repeatedly");
  await expect(page.getByRole("main")).not.toContainText("may still be active");
  await expect(page.getByRole("main")).not.toContainText(
    "it ended in phase Succeeded",
  );

  await page.goto("/activity");
  await expect(page.getByRole("main")).toContainText(
    "Step step-sync was still running when the deployment ended",
  );
  await expect(page.getByRole("main")).not.toContainText("may still be active");
  await expect(page.getByRole("main")).not.toContainText(
    "it ended in phase Succeeded",
  );

  await page.goto("/pipelines/streambot");
  const prod = page.getByRole("region", { name: "prod", exact: true });
  await expect(prod).toContainText(
    "interrupted · recovery read back phase Succeeded",
  );
  await expect(prod).not.toContainText("may still be active");
  await expect(prod).not.toContainText("outcome unknown");
});

test("a release recovery read back as applied says so, and that Delivery never accepted it", async ({
  page,
}) => {
  await page.goto(`/deployments/${await deploymentId(page, APPLIED_REQUEST)}`);
  const main = page.getByRole("main");
  await expect(main.locator(".page-header").getByRole("status")).toHaveText(
    /failed · applied, not accepted$/u,
  );
  const why = main.getByRole("region", { name: "Why it failed" });
  // The step it ended on leads; the readback follows as what recovery found.
  await expect(why).toContainText(
    "was still running when the deployment ended; recovery has since read its outcome back",
  );
  await expect(why).toContainText("it ended in phase Succeeded.");
  await expect(why).toContainText(
    "but Delivery never accepted r4: r3 is still accepted in streambot/prod",
  );
  await expect(why).not.toContainText("Fix the cause");
  // A retry is how Delivery comes to accept it.
  await expect(
    main.getByRole("button", { name: "Retry as a new deployment" }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("the environment names the desired image recovery applied, and its newest failure", async ({
  page,
}) => {
  await page.goto(`/environments/${RECOVERY_PROD}`);
  const main = page.getByRole("main");
  const header = main.locator(".page-header");
  await expect(header).toContainText("Nothing in flight · ");
  await expect(
    header.getByRole("link", { name: "newest release r4 failed" }),
  ).toHaveAttribute("href", /^\/deployments\//u);
  const runtime = main.getByRole("region", { name: "Live runtime" });
  await expect(runtime).toContainText(
    "image:streambot runs desired r4's digest, which Delivery has not accepted",
  );
  await expect(runtime).toContainText("not accepted");
  await expect(runtime.locator(".status-failed")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("a failure a newer acceptance superseded offers no retry, and says why", async ({
  page,
}) => {
  await page.goto(
    `/deployments/${await deploymentId(page, SUPERSEDED_REQUEST)}`,
  );
  const main = page.getByRole("main");
  await expect(main.locator(".page-header").getByRole("status")).toHaveText(
    /failed · superseded by r3$/u,
  );
  const why = main.getByRole("region", { name: "Why it failed" });
  await expect(why).toContainText("Superseded by r3");
  await expect(why).toContainText("Retry is off");
  await expect(why).not.toContainText("Fix the cause");
  await expect(
    main.getByRole("button", { name: "Retry as a new deployment" }),
  ).toHaveCount(0);
});

test("a failure with a newer request queued offers no retry, says why, and quotes the refusal", async ({
  page,
}) => {
  await page.goto(
    `/deployments/${await deploymentId(page, REFUSED_REQUEST, HELD_PROD)}`,
  );
  const main = page.getByRole("main");
  const why = main.getByRole("region", { name: "Why it failed" });
  // The recorded refusal is in the prose, not behind "inspect Workflow history".
  await expect(why).toContainText(`failed: ${REFUSAL}`);
  await expect(why).toContainText("A newer request, r2, is queued;");
  await expect(why).toContainText("Retry is off until it settles");
  await expect(why).not.toContainText("Fix the cause");
  await expect(
    why.getByRole("link", { name: "r2", exact: true }),
  ).toHaveAttribute("href", /^\/deployments\//u);
  await expect(
    main.getByRole("button", { name: "Retry as a new deployment" }),
  ).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("an environment that refuses requests says why beside the request button", async ({
  page,
}) => {
  // Arcade prod: an override deploy awaits approval, so requests are refused.
  await page.goto("/environments/arcade/prod");
  const form = page.getByRole("region", { name: "Request a release" });
  await expect(form).toContainText(
    "is awaiting approval. Requests are refused until it finishes or is canceled.",
  );
  await expect(form).not.toContainText(
    "This request will wait for a human approval",
  );
});

test("a promotion awaiting approval says how long it has waited, not that it is running", async ({
  page,
}) => {
  await page.goto("/pipelines/arcade");
  const prod = page.getByRole("region", { name: "prod", exact: true });
  await expect(prod.locator(".stage-standing")).toContainText(
    "r4 awaiting approval",
  );
  const action = prod.getByRole("listitem").filter({ hasText: "deploy r4" });
  await expect(action).toContainText(/awaiting approval for \d/u);
  await expect(action).not.toContainText("running");
});
