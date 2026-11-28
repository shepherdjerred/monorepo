import { expect, test } from "@playwright/test";
import { installRecordedDrawProbe } from "#replay-e2e/recorded-draw-probe.ts";
import { verifyRecordedCurrentNeutralObjectives } from "#replay-e2e/recorded-neutral-assertions.ts";
import {
  contentPath,
  readRecordedReplay,
} from "#replay-e2e/recorded-replay-data.ts";
import { observeRecordedReplayRequests } from "#replay-e2e/recorded-replay-fixture.ts";

test("signed-out recorded replay draws neutral objectives at exact replay times", async ({
  baseURL,
  page,
}, testInfo) => {
  const fixture = await readRecordedReplay();
  test.skip(
    fixture.directNeutralModels === undefined,
    "Requires current recorded neutral models.",
  );
  if (baseURL === undefined)
    throw new Error("A loopback base URL is required.");
  const traffic = await observeRecordedReplayRequests(page, baseURL);
  await installRecordedDrawProbe(page);
  await verifyRecordedCurrentNeutralObjectives(page, fixture, testInfo);
  expect(traffic.requested).toContain(contentPath);
  expect(traffic.requested).toContain(fixture.entrypoint);
  expect(traffic.credentialed.size).toBe(0);
});
