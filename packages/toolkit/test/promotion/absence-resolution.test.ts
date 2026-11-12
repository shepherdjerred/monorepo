import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { handlePromotionAbsence } from "#handlers/promotion-absence.ts";
import { PROMOTION_ABSENCE_ATTESTATION } from "@shepherdjerred/ops-model/promotion/absence-resolution.ts";

function fixture() {
  const facts = {
    version: 1,
    namespace: "prod",
    targetId: "fixture",
    action: "bump",
    originalOccurrenceId:
      "storm-promotion/fixture/00000000-0000-4000-8000-000000000001",
    attemptedAt: "2026-01-01T12:00:00Z",
    contentHash: "a".repeat(64),
    entity: {
      id: "fixture",
      name: "Fixture",
      slug: "fixture",
      url: "https://example.com/servers/fixture",
    },
    observation: {
      pageUrl: "https://example.com/dashboard",
      observedAt: "2026-01-01T12:03:00Z",
      basis: "last-bump-watermark",
      field: "last_bumped_at",
      lastActionAt: "2025-12-31T12:00:00Z",
      artifacts: [
        {
          kind: "official-source",
          url: "https://example.com/official.js",
          sha256: "b".repeat(64),
        },
        { kind: "scoped-observation", sha256: "c".repeat(64) },
      ],
    },
    review: { reference: "AI365", attestation: PROMOTION_ABSENCE_ATTESTATION },
  };
  const evidenceJson = JSON.stringify(facts);
  const digest = createHash("sha256").update(evidenceJson).digest("hex");
  const args = [
    "fixture",
    "--evidence-file",
    "/owned/evidence.json",
    "--evidence-sha256",
    digest,
    "--resolution-id",
    "00000000-0000-4000-8000-000000000003",
    "--json",
  ];
  return {
    args,
    evidenceJson,
    digest,
    runtime: {
      read: vi
        .fn<(path: string) => Promise<string>>()
        .mockResolvedValue(evidenceJson),
      run: vi
        .fn<(args: string[], input: string) => Promise<number>>()
        .mockResolvedValue(0),
      write: vi.fn<(text: string) => void>(),
    },
  };
}

describe("absence resolution CLI boundary", () => {
  it("plans by default and forwards evidence through stdin, never native argv", async () => {
    const f = fixture();
    await handlePromotionAbsence(f.args, f.runtime);
    const call = f.runtime.run.mock.calls[0];
    expect(call).toBeDefined();
    if (call === undefined) throw new Error("Expected invocation");
    expect(call[0]).toEqual(
      expect.arrayContaining([
        "toolkit",
        "temporal",
        "prod",
        "resolveStormPromotionAbsence",
        "--input-file",
        "/dev/stdin",
      ]),
    );
    expect(call[0]).not.toContain("--input");
    expect(JSON.stringify(call[0])).not.toContain("last_bumped_at");
    expect(JSON.parse(call[1])).toMatchObject({
      apply: false,
      namespace: "prod",
      evidenceJson: f.evidenceJson,
    });
    expect(f.runtime.write).not.toHaveBeenCalled();
  });
  it("requires explicit apply and reviewed ETag, retaining the same evidence bytes", async () => {
    const f = fixture();
    await expect(
      handlePromotionAbsence([...f.args, "--apply"], f.runtime),
    ).rejects.toThrow("reviewed ETag");
    expect(f.runtime.run).not.toHaveBeenCalled();
    await handlePromotionAbsence(
      [...f.args, "--apply", "--expected-state-etag", '"reviewed"'],
      f.runtime,
    );
    expect(
      JSON.parse(f.runtime.run.mock.calls[0]?.[1] ?? "null"),
    ).toMatchObject({
      apply: true,
      expectedStateEtag: '"reviewed"',
      evidenceSha256: f.digest,
    });
  });
  it("dry-run prints safe invocation metadata without evidence or a Workflow start", async () => {
    const f = fixture();
    await handlePromotionAbsence([...f.args, "--dry-run"], f.runtime);
    expect(f.runtime.run).not.toHaveBeenCalled();
    const output = f.runtime.write.mock.calls[0]?.[0] ?? "";
    expect(output).toContain(f.digest);
    expect(output).not.toContain("last_bumped_at");
    expect(output).not.toContain(f.evidenceJson);
  });
  it("stops on native failure without replaying the observer or decision", async () => {
    const f = fixture();
    f.runtime.run.mockResolvedValue(9);
    await expect(handlePromotionAbsence(f.args, f.runtime)).rejects.toThrow(
      "failed (9)",
    );
    expect(f.runtime.run).toHaveBeenCalledTimes(1);
  });
  it("rejects wrong digest, extra private fields and mismatched target before dispatch", async () => {
    const f = fixture();
    await expect(
      handlePromotionAbsence(
        f.args.map((a) => (a === f.digest ? "d".repeat(64) : a)),
        f.runtime,
      ),
    ).rejects.toThrow("digest");
    await expect(
      handlePromotionAbsence(["other", ...f.args.slice(1)], f.runtime),
    ).rejects.toThrow("identity");
    f.runtime.read.mockResolvedValue(
      f.evidenceJson.replace(
        '"version":1',
        '"version":1,"private":"private-value-must-not-leak"',
      ),
    );
    const invalid = await f.runtime.read("fixture");
    const invalidHash = createHash("sha256").update(invalid).digest("hex");
    await expect(
      handlePromotionAbsence(
        f.args.map((a) => (a === f.digest ? invalidHash : a)),
        f.runtime,
      ),
    ).rejects.toThrow("schema");
    expect(f.runtime.run).not.toHaveBeenCalled();
    expect(f.runtime.write).not.toHaveBeenCalled();
  });
});
