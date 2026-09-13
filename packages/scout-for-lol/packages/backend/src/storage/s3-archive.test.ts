import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  loadRawMatchFixture,
  rawTimelineFixture,
} from "#src/testing/raw-capture-fixtures.ts";
import { Sha256DigestSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { ArtifactDescriptorSchema } from "@scout-for-lol/domain/artifacts/descriptors.ts";
import { archiveMatchToS3, archiveTimelineToS3 } from "#src/storage/s3.ts";
import {
  getValidatedPutCommand,
  mockSuccessfulPut,
  resetS3TestState,
  s3Mock,
  setS3TestBucket,
} from "#src/storage/s3-test-helpers.ts";

function sha256OfPutBody(callIndex = 0): string {
  const command = getValidatedPutCommand(callIndex);
  const body = command.input.Body;
  const bytes =
    body instanceof Uint8Array ? body : new TextEncoder().encode(body);
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(bytes);
  return hasher.digest("hex");
}

beforeEach(resetS3TestState);
afterEach(resetS3TestState);

describe("archived match descriptors", () => {
  test("stores the payload digest as object metadata", async () => {
    const match = await loadRawMatchFixture();
    mockSuccessfulPut();

    await archiveMatchToS3(match, []);

    const command = getValidatedPutCommand();
    expect(command.input.Metadata?.["sha256"]).toBe(sha256OfPutBody());
  });

  test("returns a descriptor whose digest parses through the domain brand", async () => {
    const match = await loadRawMatchFixture();
    mockSuccessfulPut();

    const result = await archiveMatchToS3(match, []);

    if (result.status !== "saved") throw new Error("expected a saved archive");
    expect(Sha256DigestSchema.parse(result.artifact.digest)).toBe(
      result.artifact.digest,
    );
    expect(ArtifactDescriptorSchema.parse(result.artifact)).toEqual(
      result.artifact,
    );
  });

  test("describes the key that was actually written, not a recomputed one", async () => {
    const match = await loadRawMatchFixture();
    mockSuccessfulPut();

    const result = await archiveMatchToS3(match, []);

    if (result.status !== "saved") throw new Error("expected a saved archive");
    expect(result.artifact.key).toBe(getValidatedPutCommand().input.Key);
    expect(result.artifact.kind).toBe("match");
    expect(result.artifact.contentType).toBe("application/json");
  });

  test("reports the exact byte count uploaded", async () => {
    const match = await loadRawMatchFixture();
    mockSuccessfulPut();

    const result = await archiveMatchToS3(match, []);

    if (result.status !== "saved") throw new Error("expected a saved archive");
    const body = getValidatedPutCommand().input.Body;
    const bytes =
      body instanceof Uint8Array ? body : new TextEncoder().encode(body);
    expect(result.artifact.bytes).toBe(bytes.length);
  });

  test("records nothing and archives nothing without a bucket", async () => {
    const match = await loadRawMatchFixture();
    setS3TestBucket(undefined);
    mockSuccessfulPut();

    const result = await archiveMatchToS3(match, []);

    expect(result).toEqual({ status: "skipped_no_bucket" });
    expect(s3Mock.calls()).toHaveLength(0);
  });
});

describe("timeline partition cutover", () => {
  test("keys the timeline by the match's game-creation date", async () => {
    // 2026-03-10T02:30Z is still 2026-03-09 in Pacific time, so this case also
    // pins WHICH day the shared `generateS3Key` derivation picks — the point is
    // that the timeline lands on the same one the match does.
    const gameCreatedAt = new Date("2026-03-10T02:30:00.000Z");
    const timeline = rawTimelineFixture("NA1_5555555555");
    mockSuccessfulPut();

    const result = await archiveTimelineToS3(timeline, [], gameCreatedAt);

    if (result.status !== "saved") throw new Error("expected a saved archive");
    expect(result.artifact.key).toBe(getValidatedPutCommand().input.Key);
    expect(result.artifact.kind).toBe("timeline");
  });

  test("puts the timeline under the same prefix as its match", async () => {
    const match = await loadRawMatchFixture();
    const gameCreatedAt = new Date(match.info.gameCreation);
    const timeline = rawTimelineFixture(match.metadata.matchId);
    mockSuccessfulPut();

    await archiveMatchToS3(match, []);
    await archiveTimelineToS3(timeline, [], gameCreatedAt);

    const matchKey = getValidatedPutCommand(0).input.Key;
    const timelineKey = getValidatedPutCommand(1).input.Key;
    expect(matchKey).toMatch(/\/match\.json$/);
    expect(timelineKey).toMatch(/\/timeline\.json$/);
    expect(timelineKey.replace(/timeline\.json$/, "match.json")).toBe(matchKey);
  });

  test("ignores the upload time, which is what the old layout used", async () => {
    const gameCreatedAt = new Date("2020-01-02T12:00:00.000Z");
    const timeline = rawTimelineFixture("NA1_1234567890");
    mockSuccessfulPut();

    await archiveTimelineToS3(timeline, [], gameCreatedAt);

    expect(getValidatedPutCommand().input.Key).toBe(
      "games/2020/01/02/NA1_1234567890/timeline.json",
    );
  });

  test("stores the timeline digest as object metadata too", async () => {
    const timeline = rawTimelineFixture("NA1_1234567890");
    mockSuccessfulPut();

    const result = await archiveTimelineToS3(
      timeline,
      [],
      new Date("2026-01-01T00:00:00.000Z"),
    );

    if (result.status !== "saved") throw new Error("expected a saved archive");
    expect(getValidatedPutCommand().input.Metadata?.["sha256"]).toBe(
      result.artifact.digest,
    );
  });
});
