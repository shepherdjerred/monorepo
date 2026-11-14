import { expect, test } from "vitest";
import { captureDrainInventory } from "./drain-inventory.ts";
import { captureGetFixture as wire } from "./capture.test-fixture.ts";
const source = {
  source: "sonarr" as const,
  sourceInstanceId: "a".repeat(64),
  baseUrl: "http://127.0.0.1:8989",
  apiKey: "synthetic",
};
test("empty stable queues and no running commands establish only drain, never stopped writers", async () => {
  const result = await captureDrainInventory(
    source,
    wire((url) =>
      url.pathname.endsWith("command")
        ? [
            {
              id: 9,
              name: "RefreshSeries",
              status: "completed",
              secret: "stripped",
            },
          ]
        : { page: 1, totalRecords: 0, records: [] },
    ),
  );
  expect(result).toMatchObject({
    drained: true,
    stable: true,
    provesWritersStopped: false,
    changesTorrentOwnership: false,
  });
  expect(JSON.stringify(result)).not.toContain("stripped");
});
test("queued imports or running refresh commands block drain and changing queues remain unproven", async () => {
  expect(
    await captureDrainInventory(
      source,
      wire((url) =>
        url.pathname.endsWith("command")
          ? [{ id: 9, name: "DownloadedEpisodesScan", status: "started" }]
          : { page: 1, totalRecords: 0, records: [] },
      ),
    ),
  ).toMatchObject({ drained: false });
  let pass = 0;
  const result = await captureDrainInventory(
    source,
    wire((url) =>
      url.pathname.endsWith("command")
        ? []
        : {
            page: 1,
            totalRecords: ++pass === 1 ? 1 : 0,
            records: pass === 1 ? [{ id: 1, status: "completed" }] : [],
          },
    ),
  );
  expect(result).toMatchObject({ stable: false, drained: false });
});
