import { describe, expect, test } from "vitest";
import { isCrdImportsRefreshPr } from "./homelab-crd-imports-refresh.ts";

const proposal = {
  title: "chore(homelab): refresh generated cdk8s CRD imports",
  url: "https://github.com/shepherdjerred/monorepo/pull/3597",
  baseRefName: "main",
  headRefName: "chore/crd-imports-refresh-a1b2c3d4",
  isCrossRepository: false,
  author: { is_bot: true, login: "app/updater" },
};

describe("CRD proposal identity", () => {
  test("accepts the authenticated legacy and stable proposal families", () => {
    expect(isCrdImportsRefreshPr(proposal, "updater")).toBe(true);
    expect(
      isCrdImportsRefreshPr(
        {
          ...proposal,
          headRefName: "chore/crd-imports-refresh",
          author: { is_bot: true, login: "updater[bot]" },
        },
        "updater",
      ),
    ).toBe(true);
  });
  test.each([
    { isCrossRepository: true },
    { baseRefName: "other" },
    { headRefName: "chore/unrelated" },
    { title: "Other proposal" },
    { author: { is_bot: false, login: "updater" } },
    { author: { is_bot: true, login: "another[bot]" } },
  ])("rejects a lookalike proposal: %j", (change) => {
    expect(isCrdImportsRefreshPr({ ...proposal, ...change }, "updater")).toBe(
      false,
    );
  });
});
