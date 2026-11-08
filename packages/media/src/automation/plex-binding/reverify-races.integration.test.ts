import { afterEach, expect, test, vi } from "vitest";
import { rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { PlexClient } from "#integrations/plex.ts";
import { ReverifyPlexBindingInputSchema } from "#shared/plex-binding/activities.ts";
import { createPlexBindingActivities } from "./activities.ts";
import { queueExistingPlexBinding } from "./queue.ts";
import { plexBindingFixture, bindingTestExecution } from "./test-fixture.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

test.each([
  "returned_verifier_protection",
  "thrown_prelude_drift",
  "expired_after_winner",
] as const)(
  "a real concurrent completion wins over %s without minting a second receipt",
  async (mode) => {
    const db = harness.database();
    const f = await plexBindingFixture(db, harness.context());
    directories.push(f.files.directory);
    const queued = await queueExistingPlexBinding(f.context, f.asset.id);
    if (queued.status !== "queued")
      throw new Error(`Expected queued fixture: ${queued.reason}`);
    const operation = await db.operation.findUniqueOrThrow({
      where: { id: queued.operationId },
    });
    const input = ReverifyPlexBindingInputSchema.parse(operation.payload);
    let winnerCommitted = false;
    const winner = async () => {
      expect(
        await createPlexBindingActivities(f.context).reverify(
          input,
          bindingTestExecution(),
        ),
      ).toEqual({ status: "verified", bindingCount: 1 });
      winnerCommitted = true;
    };
    const invocation = bindingTestExecution();
    const losing =
      mode === "returned_verifier_protection"
        ? {
            ...f.context,
            plex: new PlexClient(
              {
                baseUrl: "http://loser.fixture",
                token: "synthetic",
                clientIdentifier: "synthetic",
              },
              async (url) => {
                expect(url.pathname).toBe("/identity");
                await winner();
                return Response.json({
                  MediaContainer: { machineIdentifier: "changed-server" },
                });
              },
            ),
          }
        : {
            ...f.context,
            plexAccess: async (sectionType: "movie" | "show") => {
              await winner();
              if (mode === "expired_after_winner")
                vi.spyOn(Date, "now").mockReturnValue(invocation.expiresAtMs);
              return f.context.plexAccess(sectionType);
            },
          };
    expect(
      await createPlexBindingActivities(losing).reverify(input, invocation),
    ).toEqual({ status: "verified", bindingCount: 1 });
    expect(winnerCommitted).toBe(true);
    expect(
      await db.plexBindingVerificationReceipt.count({
        where: { operationId: operation.id },
      }),
    ).toBe(1);
    expect(
      await db.plexBindingCurrent.count({
        where: { mediaId: f.files.media.id, evidenceId: { not: null } },
      }),
    ).toBe(1);
  },
);

test("inventory queue retains its invocation's earlier SDK cap instead of renewing sixty seconds", async () => {
  const db = harness.database();
  const f = await plexBindingFixture(db, harness.context());
  directories.push(f.files.directory);
  const invocation = bindingTestExecution();
  const expiresAtMs = invocation.observed.wall + 100;
  const result = await queueExistingPlexBinding(
    {
      ...f.context,
      plexBindingExecution: () => ({ ...invocation, expiresAtMs }),
      plexAccess: async (kind) => {
        const access = await f.context.plexAccess(kind);
        vi.spyOn(Date, "now").mockReturnValue(expiresAtMs);
        return access;
      },
    },
    f.asset.id,
  );
  expect(result).toEqual({
    status: "protected",
    reason: "verification_expired",
  });
  expect(
    await db.plexBindingVerificationRequest.count({
      where: {
        expected: {
          path: ["newGroups"],
          array_contains: [{ assetId: f.asset.id }],
        },
      },
    }),
  ).toBe(0);
  expect(f.calls).toEqual([]);
});
