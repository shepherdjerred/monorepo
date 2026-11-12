import { describe, expect, it } from "vitest";
import { PromotionStateSchema } from "#shared/promotion/model.ts";
import {
  fixture,
  hash,
  originalRun,
  latestRun,
} from "./absence-resolution.fixture.ts";

describe("operator absence resolution commitment", () => {
  it("plans without writes and binds the reviewed state ETag and original occurrence", async () => {
    const f = fixture();
    expect(await f.execute()).toMatchObject({
      status: "plan",
      prepared: false,
      expectedStateEtag: '"reviewed"',
      originalOccurrenceId: f.facts.originalOccurrenceId,
      paused: true,
    });
    expect(f.writes).toEqual([]);
    expect(f.reads).toEqual(["latest", originalRun]);
  });
  it("archives immutable evidence, CAS-settles only the original, and pauses without publishing", async () => {
    const f = fixture();
    f.state.nextEligibleAt = "2026-01-02T12:00:00.000Z";
    const result = await f.execute({ apply: true });
    expect(result.status).toBe("applied");
    const row = f.rows.get("targets/fixture.json");
    const next = PromotionStateSchema.parse(row?.value);
    expect(next).toMatchObject({
      paused: true,
      lock: null,
      executionHealth: f.state.executionHealth,
      bufferSeconds: f.state.bufferSeconds,
      nextEligibleAt: f.state.nextEligibleAt,
      attempts: [
        {
          occurrenceId: f.facts.originalOccurrenceId,
          status: "no-action",
          receiptUrl: null,
          evidenceKey: null,
          contentHash: f.facts.contentHash,
          beforeSubmission: [],
          settledAt: "2026-01-01T12:04:00.000Z",
        },
      ],
    });
    expect(f.writes).toHaveLength(2);
    expect(f.writes[0]?.key).toMatch(/^absence-resolutions\/fixture\//);
    expect(f.writes[0]?.etag).toBeUndefined();
    expect(f.writes[1]).toEqual({
      key: "targets/fixture.json",
      etag: '"reviewed"',
    });
    const writes = structuredClone(f.writes);
    expect(await f.execute()).toMatchObject({
      status: "already-applied",
      paused: true,
    });
    expect(f.writes).toEqual(writes);
  });
  it("preserves an existing image evidence key and keeps the JSON audit in its own marker", async () => {
    const f = fixture();
    const attempt = f.state.attempts[0];
    if (attempt === undefined) throw new Error("Fixture missing");
    attempt.evidenceKey =
      "storm/promotion/v1/prod/evidence/fixture/original.png";
    await f.execute({ apply: true });
    const resolved = PromotionStateSchema.parse(
      f.rows.get("targets/fixture.json")?.value,
    ).attempts[0];
    expect(resolved?.evidenceKey).toBe(attempt.evidenceKey);
    expect(resolved?.operatorResolution?.auditKey).toMatch(
      /^absence-resolutions\/.*\.json$/,
    );
  });
  it("never treats an audit prepared before a failed CAS as applied", async () => {
    const f = fixture();
    f.conflict();
    await expect(f.execute({ apply: true })).rejects.toThrow("CAS conflicted");
    const unchanged = PromotionStateSchema.parse(
      f.rows.get("targets/fixture.json")?.value,
    );
    expect(unchanged).toEqual(f.state);
    expect(await f.execute()).toMatchObject({ status: "plan", prepared: true });
    expect(f.writes.filter((w) => w.key.startsWith("targets/"))).toHaveLength(
      1,
    );
  });
  it("aborts on reviewed-state conflict without rebasing or writing evidence", async () => {
    const f = fixture();
    await expect(
      f.execute({ apply: true, expectedStateEtag: '"changed"' }),
    ).rejects.toThrow("ETag changed");
    expect(f.writes).toEqual([]);
  });
  it("does not initialize missing state or proceed when immutable audit creation conflicts", async () => {
    const missing = fixture();
    missing.rows.clear();
    await expect(missing.execute()).rejects.toThrow("state is missing");
    expect(missing.writes).toEqual([]);
    const f = fixture();
    const keys: string[] = [];
    f.store.put = (key) => {
      keys.push(key);
      return Promise.resolve(false);
    };
    await expect(f.execute({ apply: true })).rejects.toThrow(
      "creation conflicted",
    );
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^absence-resolutions\//);
    expect(
      PromotionStateSchema.parse(f.rows.get("targets/fixture.json")?.value),
    ).toEqual(f.state);
  });
  it("preserves unrelated historical attempts while resolving the exact original", async () => {
    const f = fixture();
    const original = f.state.attempts[0];
    if (original === undefined) throw new Error("Fixture missing");
    const old = {
      ...original,
      occurrenceId: "manual/previous-verified",
      status: "verified" as const,
      settledAt: "2025-12-31T12:00:00.000Z",
      receiptUrl: f.facts.entity.url,
    };
    f.state.attempts.unshift(old);
    await f.execute({ apply: true });
    const next = PromotionStateSchema.parse(
      f.rows.get("targets/fixture.json")?.value,
    );
    expect(next.attempts[0]).toEqual(old);
    expect(next.attempts[1]?.status).toBe("no-action");
  });
  it("detects changed evidence on idempotent readback", async () => {
    const f = fixture();
    await f.execute({ apply: true });
    f.facts.entity.id = "different-entity";
    const evidenceJson = JSON.stringify(f.facts);
    await expect(
      f.execute({ evidenceJson, evidenceSha256: hash(evidenceJson) }),
    ).rejects.toThrow("committed evidence");
    expect(f.writes).toHaveLength(2);
  });
});

describe("absence decision safety boundaries", () => {
  it("accepts the installed Temporal SDK's closed CANCELLED status", async () => {
    const f = fixture();
    f.owner.status = "CANCELLED";
    expect(await f.execute()).toMatchObject({ status: "plan" });
    expect(f.writes).toEqual([]);
  });
  it.each(["RUNNING", "UNKNOWN"])(
    "refuses %s original/latest owners",
    async (status) => {
      const f = fixture();
      f.owner.status = status;
      await expect(f.execute({ apply: true })).rejects.toThrow(
        "requires closed",
      );
      expect(f.writes).toEqual([]);
    },
  );
  it("blocks when owner history is unavailable", async () => {
    const f = fixture();
    f.owner.closedAt = "invalid";
    await expect(f.execute({ apply: true })).rejects.toThrow("requires closed");
    expect(f.writes).toEqual([]);
  });
  it("checks the original owner even when the latest owner has already closed", async () => {
    const f = fixture();
    f.ownerOverrides.set(originalRun, { status: "RUNNING" });
    await expect(f.execute({ apply: true })).rejects.toThrow("requires closed");
    expect(f.reads).toEqual(["latest", originalRun]);
    expect(f.writes).toEqual([]);
  });
  it("requires evidence observed after closure and an older authoritative watermark", async () => {
    const f = fixture();
    f.owner.closedAt = "2026-01-01T12:03:30.000Z";
    await expect(f.execute()).rejects.toThrow("predates");
    f.facts.observation.lastActionAt = f.facts.attemptedAt;
    const evidenceJson = JSON.stringify(f.facts);
    await expect(
      f.execute({ evidenceJson, evidenceSha256: hash(evidenceJson) }),
    ).rejects.toThrow("watermark");
    expect(f.writes).toEqual([]);
  });
  it.each([
    "contentHash",
    "attemptedAt",
    "entityUrl",
    "entitySlug",
    "officialUrl",
    "namespace",
    "extraPrivateField",
  ])("rejects mismatched %s", async (field) => {
    const f = fixture();
    const facts: Record<string, unknown> = structuredClone(f.facts);
    switch (field) {
      case "entityUrl":
        f.facts.entity.url = "https://example.com/servers/other";
        break;
      case "entitySlug":
        f.facts.entity.slug = "different-entity";
        break;
      case "officialUrl":
        f.facts.observation.pageUrl = "https://other.example/dashboard";
        break;
      case "contentHash":
        f.facts.contentHash = "d".repeat(64);
        break;
      case "attemptedAt":
        f.facts.attemptedAt = "2026-01-01T12:00:01.000Z";
        break;
      case "namespace":
        facts[field] = "beta";
        break;
      default:
        facts[field] = "private-value-must-not-appear";
    }
    const evidenceJson = JSON.stringify(
      field === "namespace" || field === "extraPrivateField" ? facts : f.facts,
    );
    await expect(
      f.execute({ evidenceJson, evidenceSha256: hash(evidenceJson) }),
    ).rejects.toThrow();
    expect(f.writes).toEqual([]);
  });
  it("refuses missing, duplicate and foreign uncertain occurrences", async () => {
    for (const variant of ["missing", "duplicate", "multiple"] as const) {
      const f = fixture();
      const attempt = f.state.attempts[0];
      if (attempt === undefined) throw new Error("Fixture missing");
      if (variant === "missing") f.state.attempts = [];
      else
        f.state.attempts.push({
          ...attempt,
          occurrenceId:
            variant === "duplicate"
              ? attempt.occurrenceId
              : `storm-promotion/fixture/${latestRun}`,
        });
      await expect(f.execute({ apply: true })).rejects.toThrow();
      expect(f.writes).toEqual([]);
    }
  });
});
