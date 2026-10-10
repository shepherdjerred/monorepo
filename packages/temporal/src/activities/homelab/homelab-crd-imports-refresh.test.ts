import { afterEach, describe, expect, test, vi } from "vitest";
import {
  findCrdImportsRefreshBranch,
  isCrdImportsRefreshPr,
} from "./homelab-crd-imports-refresh.ts";
import * as proposals from "#activities/data-dragon/data-dragon-pr.ts";

afterEach(() => vi.restoreAllMocks());

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

test("refuses a nonmatching open proposal occupying the stable branch", async () => {
  const find = vi.spyOn(proposals, "findOpenGeneratedPrUrl");
  find.mockResolvedValueOnce(undefined).mockResolvedValueOnce(proposal.url);
  await expect(findCrdImportsRefreshBranch("test-token")).rejects.toThrow(
    "failed the CRD proposal identity check",
  );
  const lookup = find.mock.calls[1]?.[0];
  expect(lookup?.filterArgs).toEqual(["--head", "chore/crd-imports-refresh"]);
  expect(
    lookup?.matches({ ...proposal, title: "Operator adjudication" }, "updater"),
  ).toBe(true);
});

test("uses the stable branch only when no open proposal occupies it", async () => {
  vi.spyOn(proposals, "findOpenGeneratedPrUrl").mockResolvedValue(undefined);
  await expect(findCrdImportsRefreshBranch("test-token")).resolves.toBe(
    "chore/crd-imports-refresh",
  );
});
