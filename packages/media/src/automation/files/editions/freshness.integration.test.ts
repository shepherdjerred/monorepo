import { afterEach, expect, test, vi } from "vitest";
import { access, readFile, rm } from "node:fs/promises";
import type * as FsPromises from "node:fs/promises";
import path from "node:path";
import { automationTestHarness } from "#testing/automation.ts";
import { fileFixture } from "#automation/files/test-support.ts";
import { boundRetentionFixture } from "#automation/retention/lifecycle.test-fixture.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { FilePlanSchema, RemovalPlanSchema } from "#automation/files/types.ts";
import { ContentProof } from "#filesystem/content-proof.ts";

const observation = vi.hoisted(
  (): { afterStat: ((filename: string) => void) | null } => ({
    afterStat: null,
  }),
);
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      try {
        return await actual.lstat(...args);
      } finally {
        observation.afterStat?.(String(args[0]));
      }
    },
  };
});
const h = automationTestHarness();
const directories: string[] = [];
afterEach(async () => {
  observation.afterStat = null;
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

test("automatic quarantine rechecks the complete movie cohort at its final target stat", async () => {
  const db = h.database();
  const bound = await boundRetentionFixture(db, h.context());
  const f = bound.files;
  directories.push(f.directory);
  const published = bound.published;
  const retention = bound.retention;
  const clock = Date.now();
  await db.plexIdentityMapping.update({
    where: { userId: f.user.id },
    data: { verifiedAt: new Date(clock - 295_000) },
  });
  let destination: string | undefined;
  let reached = false;
  const spy = vi
    .spyOn(ContentProof.prototype, "link")
    .mockImplementation(function (this: ContentProof, ...args) {
      spy.mockRestore();
      destination = args[1];
      return this.link(...args);
    });
  observation.afterStat = (filename) => {
    if (reached || filename !== destination) return;
    reached = true;
    vi.spyOn(Date, "now").mockReturnValue(clock + 10_000);
  };
  expect(
    await createMediaFileActivities(f.context).quarantineMediaFiles(
      retention.input,
    ),
  ).toEqual({ status: "protected", reason: "movie_edition_choice_changed" });
  expect(reached).toBe(true);
  expect(
    await readFile(
      path.join(f.roots.library, published.entry.libraryPath),
      "utf8",
    ),
  ).toBe(published.content);
  expect(
    await db.libraryAsset.findUniqueOrThrow({
      where: { id: published.entry.assetId },
    }),
  ).toMatchObject({ state: "published", version: 0 });
  const decision = await db.retentionDecision.findUniqueOrThrow({
    where: { id: retention.decision.id },
  });
  expect(decision).toMatchObject({
    state: "grace_period",
    quarantinedAt: null,
    purgeAfter: null,
  });
  // The ordinary preparation transaction durably allocates the removal plan,
  // independently of the refused effect transaction.
  const plan = RemovalPlanSchema.parse(decision.manifest);
  expect(plan.assets).toHaveLength(1);
  const entry = plan.assets[0];
  if (entry === undefined)
    throw new Error("Prepared removal descriptor missing");
  expect(entry.assetId).toBe(published.entry.assetId);
  await expect(
    access(path.join(f.roots.control, `quarantine/${entry.quarantineId}`)),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

test.each(["stage", "publish"] as const)(
  "mapping expiry at the final %s destination stat prevents the actual syscall",
  async (phase) => {
    const db = h.database();
    const f = await fileFixture(db);
    directories.push(f.directory);
    const acquired = await f.acquisition();
    const activities = createMediaFileActivities(f.context);
    if (phase === "publish")
      expect(await activities.inspectAndStageMedia(acquired.input)).toEqual({
        status: "staged",
      });
    const clock = Date.now();
    await db.plexIdentityMapping.update({
      where: { userId: f.user.id },
      data: { verifiedAt: new Date(clock - 295_000) },
    });
    let armed = false;
    let reached = false;
    let destination: string | undefined;
    const primitive = phase === "stage" ? "rename" : "link";
    const spy = vi
      .spyOn(ContentProof.prototype, primitive)
      .mockImplementation(function (this: ContentProof, ...args) {
        spy.mockRestore();
        armed = true;
        destination = args[1];
        return this[primitive](...args);
      });
    observation.afterStat = (filename) => {
      if (!armed || reached || filename !== destination) return;
      reached = true;
      vi.spyOn(Date, "now").mockReturnValue(clock + 10_000);
    };
    const result =
      phase === "stage"
        ? await activities.inspectAndStageMedia(acquired.input)
        : await activities.promoteMediaFiles(acquired.input);
    expect(reached).toBe(true);
    expect(result).toEqual({
      status: "blocked",
      reason: "movie_edition_choice_changed",
    });
    const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: acquired.attempt.id },
    });
    const entry = FilePlanSchema.parse(attempt.filePlan)[0];
    if (entry === undefined)
      throw new Error("Actual staged descriptor missing");
    await expect(
      access(path.join(f.roots.library, entry.libraryPath)),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await db.libraryAsset.count({ where: { id: entry.assetId } })).toBe(
      0,
    );
    expect(attempt.movieEditionAuthority).toEqual(
      acquired.attempt.movieEditionAuthority,
    );
    const retained = `staging/${entry.operationId}${phase === "stage" ? ".partial" : ""}`;
    expect(await readFile(path.join(f.roots.control, retained), "utf8")).toBe(
      acquired.content,
    );
  },
);
