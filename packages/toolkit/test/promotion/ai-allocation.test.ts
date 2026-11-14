import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import {
  handlePromotionAiAllocationCommand,
  promotionAiAllocationInvocation,
} from "#handlers/promotion-ai-allocation.ts";
import { PromotionAiAllocationRequestSchema } from "@shepherdjerred/ops-model/promotion/ai-allocation.ts";

const request = () =>
  PromotionAiAllocationRequestSchema.parse({
    version: 1,
    targetId: "pmc",
    workflowId: "storm-promotion/pmc",
    runId: "01a1cfc4-47f8-7e93-8c27-c375610f23ec",
    executionStartedAt: "2026-11-12T12:38:30Z",
    executionClosedAt: "2026-11-12T12:38:43Z",
    day: "2026-11-12",
    provider: {
      startAt: "2026-11-12T12:37:00Z",
      endAt: "2026-11-12T12:40:00Z",
      observedAt: "2026-11-12T12:47:13Z",
      querySha256: "a".repeat(64),
      responseSha256: "b".repeat(64),
      apiKeyId: "key-id",
      projectId: "project-id",
      model: "gpt-5.6-luna",
      hasMore: false,
      buckets: [
        { startTime: 1_794_487_020, endTime: 1_794_487_080, results: [] },
      ],
    },
    review: {
      operator: "fixture",
      reason: "Explicit operator review of authoritative provider evidence",
      copiedAuthoritativeResponse: true,
      coversWholeGeneration: true,
      relevantProviderIdentity: true,
      reportingCoverageAdequate: true,
      allocationIsNotExactBilledUsage: true,
    },
  });

it("starts a native read-only plan by default and forwards reviewed evidence through stdin", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "allocation-cli-fixture-"),
  );
  try {
    const file = path.join(directory, "review.json");
    await Bun.write(file, JSON.stringify(request()));
    const run = vi.fn(async (_args: string[], _input: string) => 0),
      write = vi.fn();
    await handlePromotionAiAllocationCommand(["--file", file, "--json"], {
      run,
      write,
    });
    expect(run).toHaveBeenCalledExactlyOnceWith(
      promotionAiAllocationInvocation(request(), true),
      JSON.stringify(request()),
    );
    const command = run.mock.calls[0]?.[0];
    expect(command).toContain("/dev/stdin");
    expect(command?.join(" ")).not.toContain("fixture");
    run.mockClear();
    await handlePromotionAiAllocationCommand(["--file", file, "--dry-run"], {
      run,
      write,
    });
    expect(run).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith(
      expect.stringContaining('"mode": "dry-run"'),
    );
    await expect(
      handlePromotionAiAllocationCommand(["--file", file, "--apply"], {
        run,
        write,
      }),
    ).rejects.toThrow("ledger version");
    const reviewed = {
      ...request(),
      operation: "apply",
      expectedLedgerEtag: "reviewed-etag",
      expectedRowSha256: "c".repeat(64),
      expectedAuditId: "d".repeat(64),
    };
    await Bun.write(file, JSON.stringify(reviewed));
    await handlePromotionAiAllocationCommand(["--file", file, "--apply"], {
      run,
      write,
    });
    expect(run).toHaveBeenCalledExactlyOnceWith(
      promotionAiAllocationInvocation(
        PromotionAiAllocationRequestSchema.parse(reviewed),
        false,
      ),
      JSON.stringify(PromotionAiAllocationRequestSchema.parse(reviewed)),
    );
  } finally {
    await rm(directory, { recursive: true });
  }
});

it("rejects a private or oversized wrong file with a fixed message before starting a Workflow", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "allocation-cli-fixture-"),
  );
  try {
    const file = path.join(directory, "wrong.json");
    await Bun.write(
      file,
      JSON.stringify({ privateValue: "do-not-echo-this-fixture" }),
    );
    const run = vi.fn(async () => 0),
      write = vi.fn();
    await expect(
      handlePromotionAiAllocationCommand(["--file", file], { run, write }),
    ).rejects.toThrow(
      /^Invalid reviewed AI allocation evidence; no Workflow started$/,
    );
    expect(run).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    await Bun.write(file, "x".repeat(256 * 1024 + 1));
    await expect(
      handlePromotionAiAllocationCommand(["--file", file], { run, write }),
    ).rejects.toThrow("256 KiB");
  } finally {
    await rm(directory, { recursive: true });
  }
});
