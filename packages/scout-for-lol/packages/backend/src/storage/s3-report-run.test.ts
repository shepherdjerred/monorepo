/**
 * Tests for report-run chart PNG archival, using aws-sdk-client-mock.
 * Environment setup (S3_BUCKET_NAME) is handled by test-setup.ts.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { z } from "zod";
import { VisualizationSnapshotSchema } from "@scout-for-lol/data";
import {
  loadReportRunImage,
  saveReportRunVisualization,
  saveReportRunImage,
} from "#src/storage/s3-report-run.ts";

const s3Mock = mockClient(S3Client);

const PutObjectCommandSchema = z.object({
  input: z.object({
    Bucket: z.string(),
    Key: z.string(),
    ContentType: z.string(),
  }),
});

beforeEach(() => {
  Bun.env["S3_BUCKET_NAME"] = "test-bucket";
  s3Mock.reset();
});

afterEach(() => {
  s3Mock.reset();
});

describe("saveReportRunImage", () => {
  test("uploads PNG under reports/report-{reportId}/runs/{runId}.png and returns the key", async () => {
    s3Mock
      .on(PutObjectCommand)
      .resolves({ $metadata: { httpStatusCode: 200 } });

    const key = await saveReportRunImage(7, 42, Buffer.from("fake-png"));

    expect(key).toBe("reports/report-7/runs/42.png");
    expect(s3Mock.calls().length).toBe(1);
    const command = PutObjectCommandSchema.parse(s3Mock.call(0)?.args?.[0]);
    expect(command.input.Bucket).toBe("test-bucket");
    expect(command.input.Key).toBe("reports/report-7/runs/42.png");
    expect(command.input.ContentType).toBe("image/png");
  });

  test("returns null (not an error) when the S3 upload throws", async () => {
    s3Mock.on(PutObjectCommand).rejects(new Error("S3 network error"));

    const key = await saveReportRunImage(7, 42, Buffer.from("fake-png"));

    expect(key).toBeNull();
  });
});

describe("loadReportRunImage", () => {
  test("returns null (not an error) when the object does not exist", async () => {
    s3Mock
      .on(GetObjectCommand)
      .rejects(Object.assign(new Error("missing"), { name: "NoSuchKey" }));

    const result = await loadReportRunImage(7, 42);

    expect(result).toBeNull();
  });
});

describe("saveReportRunVisualization", () => {
  test("propagates a configured archive upload failure", async () => {
    s3Mock.on(PutObjectCommand).rejects(new Error("S3 network error"));
    const snapshot = VisualizationSnapshotSchema.parse({
      version: 1,
      generatedAt: "2026-08-08T00:00:00.000Z",
      kind: "TABLE",
      title: null,
      temporal: null,
      bucket: null,
      display: {
        theme: null,
        palette: null,
        smooth: false,
        stack: "none",
        rollingWindow: null,
        cumulative: false,
        sparkline: false,
      },
      series: [],
      annotations: [],
      trends: [],
    });

    await expect(saveReportRunVisualization(7, 42, snapshot)).rejects.toThrow(
      "S3 network error",
    );
  });
});
