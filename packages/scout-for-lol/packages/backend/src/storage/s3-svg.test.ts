import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { MatchIdSchema } from "@scout-for-lol/data";
import { saveSvgToS3 } from "#src/storage/s3.ts";
import {
  currentUtcDatePath,
  getValidatedPutCommand,
  mockFailedPut,
  mockSuccessfulPut,
  resetS3TestState,
  s3Mock,
  setS3TestBucket,
} from "#src/storage/s3-test-helpers.ts";

async function uploadSvg(
  matchIdValue: string,
  queueType = "solo",
  svgContent = "<svg></svg>",
) {
  return saveSvgToS3(
    MatchIdSchema.parse(matchIdValue),
    svgContent,
    queueType,
    [],
  );
}

beforeEach(resetS3TestState);
afterEach(resetS3TestState);

describe("saveSvgToS3 success cases", () => {
  test("uploads SVG with the expected parameters and URL", async () => {
    mockSuccessfulPut();

    const result = await uploadSvg(
      "NA1_1234567890",
      "solo",
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100"/></svg>',
    );
    const command = getValidatedPutCommand();

    expect(s3Mock.calls()).toHaveLength(1);
    expect(command.input.Bucket).toBe("test-bucket");
    expect(command.input.ContentType).toBe("image/svg+xml");
    expect(result).toMatch(
      /^s3:\/\/test-bucket\/games\/\d{4}\/\d{2}\/\d{2}\/NA1_1234567890\/report\.svg$/,
    );
  });

  test("handles the arena queue", async () => {
    mockSuccessfulPut();

    const result = await uploadSvg("NA1_ARENA", "arena");
    const command = getValidatedPutCommand();

    expect(s3Mock.calls()).toHaveLength(1);
    expect(command.input.Key).toContain("NA1_ARENA");
    expect(command.input.Metadata?.["queueType"]).toBe("arena");
    expect(result).toBeDefined();
  });

  test("handles large SVG content", async () => {
    mockSuccessfulPut();

    await uploadSvg(
      "NA1_LARGE_SVG",
      "solo",
      `<svg>${"x".repeat(100_000)}</svg>`,
    );

    const body = getValidatedPutCommand().input.Body;
    expect(body).toBeDefined();
    expect(body instanceof Uint8Array || typeof body === "string").toBe(true);
  });

  test("handles SVG XML entities", async () => {
    mockSuccessfulPut();

    await expect(
      uploadSvg(
        "NA1_SPECIAL_CHARS",
        "solo",
        "<svg><text>&lt;&gt;&amp;&quot;&#x27;</text></svg>",
      ),
    ).resolves.toBeDefined();
    expect(s3Mock.calls()).toHaveLength(1);
  });
});

describe("saveSvgToS3 configuration", () => {
  test("skips upload when the bucket is absent", async () => {
    setS3TestBucket(undefined);
    mockSuccessfulPut();

    await expect(uploadSvg("NA1_SVG_NO_BUCKET")).resolves.toBeUndefined();
    expect(s3Mock.calls()).toHaveLength(0);
  });
});

describe("saveSvgToS3 error handling", () => {
  test.each([
    {
      matchId: "NA1_ERROR",
      failure: "S3 upload failed",
      expected: "Failed to save SVG NA1_ERROR to S3",
    },
    {
      matchId: "EUW1_NETWORK_ERROR",
      failure: "Network timeout",
      expected: "Failed to save SVG EUW1_NETWORK_ERROR to S3",
    },
  ])(
    "reports $matchId when upload fails",
    async ({ matchId, failure, expected }) => {
      mockFailedPut(failure);

      await expect(uploadSvg(matchId)).rejects.toThrow(expected);
      expect(s3Mock.calls()).toHaveLength(3);
    },
  );
});

describe("saveSvgToS3 key and URL format", () => {
  test("uses today's date, an SVG extension, and an s3 URL", async () => {
    mockSuccessfulPut();

    const result = await uploadSvg("NA1_DATE_TEST");
    const key = getValidatedPutCommand().input.Key;

    expect(key).toMatch(
      /^games\/\d{4}\/\d{2}\/\d{2}\/NA1_DATE_TEST\/report\.svg$/,
    );
    expect(key).toContain(`games/${currentUtcDatePath()}/`);
    expect(key.endsWith(".svg")).toBe(true);
    expect(result).toMatch(/^s3:\/\/test-bucket\/games\/.+\.svg$/);
  });
});

describe("saveSvgToS3 content and metadata", () => {
  test("records content type, match, queue, and upload time", async () => {
    mockSuccessfulPut();

    await uploadSvg("NA1_METADATA");
    const command = getValidatedPutCommand();

    expect(command.input.ContentType).toBe("image/svg+xml");
    expect(command.input.Metadata?.["matchId"]).toBe("NA1_METADATA");
    expect(command.input.Metadata?.["queueType"]).toBe("solo");
    expect(command.input.Metadata?.["uploadedAt"]).toBeDefined();
  });

  test("encodes Unicode SVG content", async () => {
    mockSuccessfulPut();

    await uploadSvg("NA1_UTF8", "solo", "<svg><text>Hello 世界</text></svg>");

    const body = getValidatedPutCommand().input.Body;
    expect(body).toBeDefined();
    expect(body instanceof Uint8Array || typeof body === "string").toBe(true);
  });
});

describe("saveSvgToS3 concurrent operations", () => {
  test("handles multiple concurrent uploads", async () => {
    mockSuccessfulPut();

    const results = await Promise.all([
      uploadSvg("NA1_CONCURRENT_1", "solo", "<svg>1</svg>"),
      uploadSvg("NA1_CONCURRENT_2", "flex", "<svg>2</svg>"),
      uploadSvg("NA1_CONCURRENT_3", "arena", "<svg>3</svg>"),
    ]);

    expect(s3Mock.calls()).toHaveLength(3);
    expect(results).toHaveLength(3);
    expect(results[0]).toContain("NA1_CONCURRENT_1");
    expect(results[1]).toContain("NA1_CONCURRENT_2");
    expect(results[2]).toContain("NA1_CONCURRENT_3");
  });
});
