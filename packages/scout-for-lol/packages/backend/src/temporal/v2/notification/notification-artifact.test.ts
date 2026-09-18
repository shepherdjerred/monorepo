import { beforeEach, describe, expect, test, vi } from "vitest";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";

/**
 * The per-kind readers and the contract they enforce over persisted receipts.
 *
 * A receipt is found by its kind's own receipt kind, so what it attests is
 * a claim about THAT kind of notification — and each kind can deliver only
 * some shapes. A post-match report attesting no image, or a loading screen
 * attesting a report, is persisted data that violates the render/send
 * contract, and it parses the same way on every read. The readers refuse it
 * with `MalformedRenderReceiptError` so the delivery can park the intent
 * rather than re-driving the corrupt row: mutation proof is any reader that
 * hands such evidence through, which flips the matching case here.
 */

const stubs = vi.hoisted(() => ({
  readNotificationArtifactV2: vi.fn(),
  readVerifiedRawObjectBytes: vi.fn(),
}));

vi.mock("#src/temporal/v2/notification-receipts.ts", () => ({
  readNotificationArtifactV2: stubs.readNotificationArtifactV2,
}));
vi.mock("#src/report-store/s3-raw-source.ts", () => ({
  readVerifiedRawObjectBytes: stubs.readVerifiedRawObjectBytes,
}));
vi.mock("#src/storage/s3-client.ts", () => ({ createS3Client: () => ({}) }));
vi.mock("#src/configuration.ts", () => ({
  default: { s3BucketName: "scout-test" },
}));

const {
  MalformedRenderReceiptError,
  readAttestedPrematchArtifactV2,
  readAttestedReportArtifactV2,
} = await import("#src/temporal/v2/notification/notification-artifact.ts");

const MATCH = RiotMatchIdSchema.parse("NA1_9301");
const IMAGE = new Uint8Array([137, 80, 78, 71, 1]);
const REVIEW = new Uint8Array([137, 80, 78, 71, 2, 2]);

function attested(key: string, bytes: Uint8Array) {
  return {
    objectKey: `games/2026/09/16/NA1_9301/${key}`,
    digest: "f".repeat(64),
    bytes: bytes.byteLength,
    contentType: "image/png",
  };
}

const REPORT = {
  artifact: "report",
  riotMatchId: MATCH,
  image: attested("report.png", IMAGE),
  content: "someone finished a solo game\n\nnice game",
  components: "match-link",
  review: attested("ai-review.png", REVIEW),
};
const LOADING_SCREEN = {
  artifact: "image",
  riotMatchId: MATCH,
  ...attested("loading-screen.png", IMAGE),
};
const NONE = (reason: string) => ({
  artifact: "none",
  riotMatchId: MATCH,
  reason,
});

beforeEach(() => {
  vi.clearAllMocks();
  stubs.readVerifiedRawObjectBytes.mockImplementation((args: { key: string }) =>
    Promise.resolve(args.key.endsWith("ai-review.png") ? REVIEW : IMAGE),
  );
});

describe("the post-match reader", () => {
  test("reads the report image and the review the receipt names", async () => {
    stubs.readNotificationArtifactV2.mockResolvedValue(REPORT);

    const artifact = await readAttestedReportArtifactV2(MATCH);

    expect(artifact.image).toBe(IMAGE);
    expect(artifact.review).toBe(REVIEW);
    expect(artifact.evidence.content).toBe(REPORT.content);
    expect(stubs.readNotificationArtifactV2).toHaveBeenCalledWith(
      MATCH,
      "postmatch",
    );
    expect(stubs.readVerifiedRawObjectBytes).toHaveBeenCalledTimes(2);
  });

  test("reads a report that earned no review with one object", async () => {
    const { review: _review, ...withoutReview } = REPORT;
    stubs.readNotificationArtifactV2.mockResolvedValue(withoutReview);

    const artifact = await readAttestedReportArtifactV2(MATCH);

    expect(artifact.review).toBeUndefined();
    expect(stubs.readVerifiedRawObjectBytes).toHaveBeenCalledTimes(1);
  });

  test.each([
    {
      name: "no artifact for an unsupported queue",
      evidence: NONE("unsupported-queue"),
    },
    {
      name: "no artifact because it is text-only",
      evidence: NONE("text-only"),
    },
    { name: "a bare loading-screen image", evidence: LOADING_SCREEN },
  ])(
    "refuses a post-match receipt attesting $name as malformed",
    async (scenario) => {
      // The finding this pins: a `none` under the postmatch receipt kind was
      // thrown as a plain error and converted to a retryable failure, so the
      // intent went back to `ready` and re-drove the same row forever.
      stubs.readNotificationArtifactV2.mockResolvedValue(scenario.evidence);

      await expect(readAttestedReportArtifactV2(MATCH)).rejects.toBeInstanceOf(
        MalformedRenderReceiptError,
      );
      expect(stubs.readVerifiedRawObjectBytes).not.toHaveBeenCalled();
    },
  );

  test("refuses a report whose review bytes do not match their attested size", async () => {
    stubs.readNotificationArtifactV2.mockResolvedValue({
      ...REPORT,
      review: { ...REPORT.review, bytes: REVIEW.byteLength + 1 },
    });

    await expect(readAttestedReportArtifactV2(MATCH)).rejects.toThrow(
      /attested size/u,
    );
  });

  test("a missing receipt is a plain error, not a malformed one", async () => {
    // Nothing to judge: the Workflow renders before it sends, so this is an
    // ordering violation the delivery keeps retryable.
    stubs.readNotificationArtifactV2.mockResolvedValue(null);

    const outcome = readAttestedReportArtifactV2(MATCH);
    await expect(outcome).rejects.toThrow(/No postmatch render receipt/u);
    await expect(outcome).rejects.not.toBeInstanceOf(
      MalformedRenderReceiptError,
    );
  });
});

describe("the prematch reader", () => {
  test("reads the loading screen the receipt names", async () => {
    stubs.readNotificationArtifactV2.mockResolvedValue(LOADING_SCREEN);

    const artifact = await readAttestedPrematchArtifactV2(MATCH);

    expect(artifact).toMatchObject({ artifact: "image", bytes: IMAGE });
    expect(stubs.readNotificationArtifactV2).toHaveBeenCalledWith(
      MATCH,
      "prematch",
    );
  });

  test("hands an unsupported queue through as no artifact", async () => {
    stubs.readNotificationArtifactV2.mockResolvedValue(
      NONE("unsupported-queue"),
    );

    const artifact = await readAttestedPrematchArtifactV2(MATCH);

    expect(artifact).toMatchObject({ artifact: "none" });
    expect(stubs.readVerifiedRawObjectBytes).not.toHaveBeenCalled();
  });

  test.each([
    { name: "a post-match report", evidence: REPORT },
    { name: "a text-only absence", evidence: NONE("text-only") },
  ])(
    "refuses a prematch receipt attesting $name as malformed",
    async (scenario) => {
      stubs.readNotificationArtifactV2.mockResolvedValue(scenario.evidence);

      await expect(
        readAttestedPrematchArtifactV2(MATCH),
      ).rejects.toBeInstanceOf(MalformedRenderReceiptError);
    },
  );
});
