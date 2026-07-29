import { describe, expect, test } from "bun:test";
import { GlitterContextRefreshInputSchema } from "./glitter-context-refresh.ts";
import {
  glitterContextProposalChecksum,
  glitterContextRunIdentity,
} from "./glitter-context-refresh-identity.ts";

describe("Glitter context proposal checksum", () => {
  test("is stable across changed-file ordering and changes with file bytes", () => {
    const first = glitterContextProposalChecksum([
      { path: "b.json", bytes: new TextEncoder().encode("two") },
      { path: "a.json", bytes: new TextEncoder().encode("one") },
    ]);
    const reordered = glitterContextProposalChecksum([
      { path: "a.json", bytes: new TextEncoder().encode("one") },
      { path: "b.json", bytes: new TextEncoder().encode("two") },
    ]);
    const changed = glitterContextProposalChecksum([
      { path: "a.json", bytes: new TextEncoder().encode("changed") },
      { path: "b.json", bytes: new TextEncoder().encode("two") },
    ]);

    expect(first).toBe(reordered);
    expect(changed).not.toBe(first);
  });

  test("distinguishes a deletion from an empty file", () => {
    expect(
      glitterContextProposalChecksum([{ path: "a.json", bytes: null }]),
    ).not.toBe(
      glitterContextProposalChecksum([
        { path: "a.json", bytes: new Uint8Array() },
      ]),
    );
  });
});

describe("Glitter context activity retry identity", () => {
  test("derives a stable temp directory and branch from the workflow run ID", () => {
    const runId = "00000000-0000-4000-8000-000000000123";

    expect(glitterContextRunIdentity(runId)).toEqual(
      glitterContextRunIdentity(runId),
    );
    expect(glitterContextRunIdentity(runId)).toEqual({
      runId,
      tempDir: `/tmp/glitter-context-refresh-${runId}`,
      branch: `chore/glitter-context-refresh-${runId}`,
    });
  });
});

describe("Glitter context snapshot pin input", () => {
  test("requires a complete immutable snapshot identity", () => {
    const snapshotId = "00000000-0000-4000-8000-000000000001";
    const snapshotSha256 = "a".repeat(64);

    expect(
      GlitterContextRefreshInputSchema.parse({
        dryRun: true,
        snapshot: { snapshotId, snapshotSha256 },
      }),
    ).toEqual({
      dryRun: true,
      maxEstimatedCostUsd: 10,
      snapshot: { snapshotId, snapshotSha256 },
    });
    expect(() =>
      GlitterContextRefreshInputSchema.parse({
        dryRun: true,
        snapshot: { snapshotId },
      }),
    ).toThrow();
    expect(() =>
      GlitterContextRefreshInputSchema.parse({
        dryRun: true,
        snapshot: { snapshotSha256 },
      }),
    ).toThrow();
  });
});
