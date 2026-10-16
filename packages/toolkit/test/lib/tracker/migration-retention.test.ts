import { expect, test } from "vitest";
import { preflightCatchUp } from "#lib/tracker/migration/catch-up.ts";
import { planMigration } from "#lib/tracker/migration/normalize.ts";
import { trackerClient } from "#lib/tracker/client.ts";
import { migrationActor, migrationFixture } from "./migration-fixture.ts";

test.each(["issue-manifest", "event-manifest", "issue-row", "valid"])(
  "retention preflight verifies %s before any mutation",
  async (scenario) => {
    const snapshot = migrationFixture();
    const { records } = await planMigration(snapshot, migrationActor);
    const retained = records.find(
      (record) =>
        record.entityType === "issue" && record.data.identifier === "SJ-171",
    );
    if (!retained) throw new Error("Missing archived fixture");
    let mutations = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        if (request.method !== "GET") mutations++;
        const route = new URL(request.url).pathname;
        let data: unknown;
        if (route.endsWith("meta.bootstrap"))
          data = {
            writesEnabled: false,
            importCapabilities: ["reconcile-record-v1"],
          };
        else if (route.endsWith("import.manifest"))
          data = records
            .filter(
              (record) =>
                !(scenario === "issue-manifest" && record === retained) &&
                !(
                  scenario === "event-manifest" &&
                  record.entityType === "event" &&
                  record.externalId === "issue:" + retained.externalId
                ),
            )
            .map(({ entityType, externalId }) => ({ entityType, externalId }));
        else if (route.endsWith("issues.list"))
          data = {
            items:
              scenario === "issue-row"
                ? []
                : [
                    {
                      identifier: "SJ-171",
                      externalRef: "linear:" + retained.externalId,
                      archivedAt: "2026-01-01T00:00:00Z",
                      revision: 1,
                    },
                  ],
            nextCursor: null,
          };
        else throw new Error("Unexpected route");
        return Response.json({ result: { data } });
      },
    });
    try {
      const check = preflightCatchUp(
        trackerClient(server.url.toString()),
        snapshot,
        { previous: [], retainRemoved: ["SJ-171"], retentionRecords: records },
      );
      if (scenario === "valid") await expect(check).resolves.toBeUndefined();
      else await expect(check).rejects.toThrow(/Retained issue/);
      expect(mutations).toBe(0);
    } finally {
      await server.stop(true);
    }
  },
);
