import { test, expect } from "bun:test";
import {
  buildArchiveKey,
  type ArchiveConfig,
} from "../../src/archive-uploader.ts";

const config: ArchiveConfig = {
  bucket: "llm-archive",
  prefix: "llm",
  region: "us-east-1",
  endpoint: "http://localhost:9000",
  accessKeyId: "key",
  secretAccessKey: "secret",
  sessionToken: undefined,
  forcePathStyle: true,
};

test("buildArchiveKey produces a deterministic, date-prefixed path", () => {
  const key = buildArchiveKey(config, {
    service: "temporal",
    provider: "anthropic",
    traceId: "0123456789abcdef0123456789abcdef",
    spanId: "fedcba9876543210",
    date: new Date("2026-05-19T15:30:00.000Z"),
  });
  expect(key).toBe(
    "llm/temporal/anthropic/2026/05/19/0123456789abcdef0123456789abcdef-fedcba9876543210.json.gz",
  );
});

test("buildArchiveKey honours the configured prefix", () => {
  const key = buildArchiveKey(
    { ...config, prefix: "custom/path" },
    {
      service: "birmel",
      provider: "claude_code_sdk",
      traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      spanId: "bbbbbbbbbbbbbbbb",
      date: new Date("2026-01-02T00:00:00.000Z"),
    },
  );
  expect(key).toBe(
    "custom/path/birmel/claude_code_sdk/2026/01/02/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb.json.gz",
  );
});
