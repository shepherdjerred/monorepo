import { describe, expect, test } from "vitest";
import {
  DEFAULT_TARGET_BATCH_LIMIT,
  DefaultTargetBatchIdsSchema,
  DefaultTargetBatchSchema,
  batchAnswers,
} from "./target-batch.ts";

function ids(count: number): string[] {
  return Array.from({ length: count }, () => crypto.randomUUID());
}

describe("the ids query of the batch read", () => {
  test("reads one id and a full page of ids", () => {
    const [one = ""] = ids(1);
    expect(DefaultTargetBatchIdsSchema.parse(one)).toEqual([one]);
    const page = ids(DEFAULT_TARGET_BATCH_LIMIT);
    expect(DefaultTargetBatchIdsSchema.parse(page.join(","))).toEqual(page);
  });

  test("collapses a repeated id to its first position", () => {
    const [first = "", second = "", third = ""] = ids(3);
    expect(
      DefaultTargetBatchIdsSchema.parse(
        [second, first, second, third, first].join(","),
      ),
    ).toEqual([second, first, third]);
  });

  test.each([
    ["a missing query", undefined],
    ["an empty list", ""],
    ["an empty entry", `${crypto.randomUUID()},`],
    ["a malformed id", `${crypto.randomUUID()},not-a-media-id`],
    ["a padded id", `${crypto.randomUUID()}, ${crypto.randomUUID()}`],
    ["more than a page", ids(DEFAULT_TARGET_BATCH_LIMIT + 1).join(",")],
    [
      "more than a page of one repeated id",
      Array.from<string>({ length: DEFAULT_TARGET_BATCH_LIMIT + 1 })
        .fill(crypto.randomUUID())
        .join(","),
    ],
  ])("rejects %s", (_name, query) => {
    expect(DefaultTargetBatchIdsSchema.safeParse(query).success).toBe(false);
  });
});

describe("a batch response", () => {
  const [known = "", unknown = "", other = ""] = ids(3);
  const batch = DefaultTargetBatchSchema.parse({
    schemaVersion: 2,
    items: [
      {
        status: "ok",
        view: {
          schemaVersion: 2,
          access: "protection_only",
          scope: { mediaId: known, edition: "default" },
          expected: { mediaVersion: 3, targetVersion: null },
          ownRequests: [],
          allowedProtectiveActions: ["keep"],
        },
      },
      { status: "unavailable", mediaId: unknown, code: "media_not_found" },
    ],
  });

  test("answers exactly the ids it was asked for, in their order", () => {
    expect(batchAnswers(batch, [known, unknown])).toBe(true);
    expect(batchAnswers(batch, [unknown, known])).toBe(false);
    expect(batchAnswers(batch, [known])).toBe(false);
    expect(batchAnswers(batch, [known, unknown, other])).toBe(false);
    expect(batchAnswers(batch, [known, other])).toBe(false);
  });

  test("carries nothing beyond the single read's view or its failure code", () => {
    const [item] = batch.items;
    expect(
      DefaultTargetBatchSchema.safeParse({
        schemaVersion: 2,
        items: [{ ...item, title: "Private title" }],
      }).success,
    ).toBe(false);
    expect(
      DefaultTargetBatchSchema.safeParse({
        schemaVersion: 2,
        items: [{ status: "unavailable", mediaId: unknown, code: "hidden" }],
      }).success,
    ).toBe(false);
  });
});
