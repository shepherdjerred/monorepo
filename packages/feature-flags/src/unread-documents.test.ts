import { expect, test } from "vitest";
import { flagDeployments } from "./deployments.ts";
import { unreadFlagDocuments } from "./unread-documents.ts";

test("reports inventory documents no deployment reads", () => {
  const unread = unreadFlagDocuments();
  const keys = unread.map(
    (document) => `${document.catalog}/${document.fliptEnvironment}`,
  );
  expect(keys).toContain("justin/prod");
  expect(keys).toContain("justin/beta");
  expect(keys).toContain("temporal/beta");
  expect(keys).toContain("delivery/beta");
  expect(keys).toContain("storm/beta");
  expect(keys).not.toContain("scout/beta");
  expect(keys).not.toContain("scout/prod");
  expect(keys).not.toContain("temporal/prod");
  expect(keys).not.toContain("minecraft/tsmc");
  for (const deployment of flagDeployments) {
    expect(keys).not.toContain(
      `${deployment.catalog}/${deployment.fliptEnvironment}`,
    );
  }
});
