import { expect, test } from "vitest";
import { DefaultTargetViewSchema } from "#shared/editions/target-view.ts";
import { ApiError } from "#client/api.ts";
import { removalPhase } from "#client/presentation/removal.ts";
import {
  keepEach,
  keepSummary,
  type KeepOutcome,
  type KeepOutcomes,
} from "./keep-all.ts";

test("a removal state this client does not know is refused, not relabelled", () => {
  expect(() => removalPhase("reply_pending")).toThrow(
    'Unknown removal state "reply_pending"',
  );
});

function view(mediaId: string) {
  return DefaultTargetViewSchema.parse({
    schemaVersion: 2,
    access: "detail",
    scope: { mediaId, edition: "default" },
    expected: { mediaVersion: 1, targetVersion: 1 },
    target: { generation: 1, availability: "available", lineage: "resolved" },
    ownRequests: [],
    allowedProtectiveActions: ["keep"],
  });
}

const IDS = [1, 2, 3, 4].map(
  (index) => `00000004-0000-4000-8000-00000000000${String(index)}`,
);

async function run(
  previous: KeepOutcomes,
  fail: (mediaId: string) => Error | null,
) {
  const outcomes = new Map<string, KeepOutcome>(previous);
  const written: string[] = [];
  await keepEach({
    candidates: IDS.map((mediaId, index) => ({
      mediaId,
      view:
        index === 3
          ? new ApiError("forbidden", "Not yours to keep.", 403)
          : view(mediaId),
    })),
    previous,
    write: (submission) => {
      const { mediaId } = submission.context.scope;
      written.push(mediaId);
      const error = fail(mediaId);
      return error === null ? Promise.resolve() : Promise.reject(error);
    },
    report: (mediaId, outcome) => {
      outcomes.set(mediaId, outcome);
    },
  });
  return { outcomes, written };
}

test("keeping all parts sends each part's own command and reports each outcome", async () => {
  const first = await run(new Map(), (mediaId) =>
    mediaId === IDS[1] ? new ApiError("unavailable", "Try later.", 503) : null,
  );
  // One part failing, and one with no view, stop nothing.
  expect(first.written).toEqual(IDS.slice(0, 3));
  expect(IDS.map((id) => first.outcomes.get(id)?.status)).toEqual([
    "kept",
    "failed",
    "kept",
    "failed",
  ]);
  expect(keepSummary(first.outcomes, 4, "episodes")).toBe(
    "Kept 2 of 4 episodes for 30 days. 2 could not be kept and are marked below.",
  );

  // A second run leaves the kept parts alone and repeats the failed command.
  const second = await run(first.outcomes, () => null);
  expect(second.written).toEqual([IDS[1]]);
  expect(IDS.map((id) => second.outcomes.get(id)?.status)).toEqual([
    "kept",
    "kept",
    "kept",
    "failed",
  ]);
  expect(keepSummary(second.outcomes, 4, "episodes")).toBe(
    "Kept 3 of 4 episodes for 30 days. 1 could not be kept and is marked below.",
  );
});

test("a run with nothing left to report has no summary; a clean one says all", () => {
  expect(keepSummary(new Map(), 3, "episodes")).toBeNull();
  expect(
    keepSummary(
      new Map(IDS.slice(0, 3).map((id) => [id, { status: "kept" }])),
      3,
      "episodes",
    ),
  ).toBe("Kept all 3 episodes for 30 days.");
  expect(
    keepSummary(new Map([[IDS[0] ?? "", { status: "saving" }]]), 3, "episodes"),
  ).toBeNull();
});
