import { expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { PrismaMigrationAdministration } from "#migration/persistence.ts";
import { captureFixture } from "#migration/bundle-test-fixtures.ts";
import { normalizeTorrentObservation } from "#migration/capture/torrent-capture.ts";
import { TorrentPolicySchema } from "#integrations/qbittorrent-policy.ts";
import protocol from "#integrations/fixtures/qbittorrent-5.2.4.json";
import { networkFixture } from "./test-fixture.ts";
import { readHandoffPlan } from "./plan.ts";
import { observeTorrents } from "./torrents.ts";

const harness = automationTestHarness();
test("fresh torrent evidence preserves stable handoff identity across normal seeding but protects reused wire IDs and policy drift", async () => {
  const { context, actor, plan } = await networkFixture(
    harness.database(),
    harness.context().cipher,
  );
  const upload = protocol.uploads.find((item) => item.kind === "hybrid");
  if (!upload) throw new Error("Hybrid protocol fixture missing");
  const observed = {
    ...TorrentPolicySchema.parse(protocol.explicitMinutes),
    hash: upload.hash,
    infohash_v1: upload.infohash_v1,
    infohash_v2: upload.infohash_v2,
    name: "Synthetic",
    state: "uploading",
    category: "radarr",
    tags: "film",
    progress: 1,
    ratio: { kind: "finite" as const, value: 1 },
    seeding_time: 10,
    size: 1,
    save_path: "/downloads",
    content_path: "/downloads/file",
  };
  const snapshot = captureFixture("qbittorrent", [
    normalizeTorrentObservation(observed),
  ]);
  const captured = await new PrismaMigrationAdministration(context.db).upload(
    actor,
    { snapshot },
  );
  const entry = captured.report.entries[0];
  if (!entry) throw new Error("Captured torrent missing");
  const input = await readHandoffPlan(context.db, plan.id);
  input.manifest.captures.push({
    captureId: captured.captureId,
    captureHash: captured.captureHash,
    sourceKind: "qbittorrent",
    sourceInstanceId: snapshot.sourceInstanceId,
  });
  input.report.entries.push({ ...entry, captureHash: captured.captureHash });
  input.scope.request.selected.push({
    provenanceKey: entry.provenanceKey,
    evidenceHash: entry.observationHash,
  });
  context.qbittorrent.listAll = () => Promise.resolve([observed]);
  const first = await observeTorrents(
    context,
    input,
    AbortSignal.timeout(5000),
  );
  context.qbittorrent.listAll = () =>
    Promise.resolve([
      { ...observed, seeding_time: 20, ratio: { kind: "finite", value: 2 } },
    ]);
  const second = await observeTorrents(
    context,
    input,
    AbortSignal.timeout(5000),
  );
  expect(second[0]?.identityHash).toBe(first[0]?.identityHash);
  expect(second[0]?.observationHash).not.toBe(first[0]?.observationHash);
  expect(second[0]).toMatchObject({
    infoHash: upload.infohash_v1,
    wireId: upload.hash,
    cleanup: "protected_legacy_source",
  });
  for (const changed of [
    { ...observed, max_ratio: 500 },
    { ...observed, infohash_v1: "d".repeat(40) },
    { ...observed, infohash_v2: "e".repeat(64) },
  ]) {
    context.qbittorrent.listAll = () => Promise.resolve([changed]);
    await expect(
      observeTorrents(context, input, AbortSignal.timeout(5000)),
    ).rejects.toMatchObject({ code: "handoff_torrent_changed" });
  }
});
