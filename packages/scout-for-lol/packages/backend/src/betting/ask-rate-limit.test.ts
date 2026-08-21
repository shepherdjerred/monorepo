import { beforeEach, describe, expect, test } from "vitest";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import { bucksTestDiscordId } from "#src/testing/bucks-fixtures.ts";
import {
  getBucksAskQuotaStatus,
  resetBucksAskRateLimitStateForTests,
  tryStartBucksAsk,
  type BucksAskRateLimitIdentity,
} from "#src/betting/ask-rate-limit.ts";

const SERVER = DiscordGuildIdSchema.parse("1337623164146155593");

beforeEach(() => {
  resetBucksAskRateLimitStateForTests();
});

describe("Bryan Bucks ask rate limit", () => {
  test("enforces two questions per user per minute", () => {
    const identity = identityFor(1);
    consume(identity, 1000);
    consume(identity, 1000);

    const rejected = tryStartBucksAsk(identity, 1000);
    expect(rejected.allowed).toBe(false);
    if (rejected.allowed) throw new Error("expected the third request to fail");
    expect(rejected.reason).toContain("2 of 2");
    expect(rejected.retryAfterSeconds).toBe(60);
  });

  test("enforces twenty questions per user per hour", () => {
    const identity = identityFor(1);
    for (let index = 0; index < 20; index++) {
      consume(identity, index * 61_000);
    }
    const rejected = tryStartBucksAsk(identity, 20 * 61_000);
    expect(rejected.allowed).toBe(false);
    if (rejected.allowed)
      throw new Error("expected the hourly request to fail");
    expect(rejected.reason).toContain("20 of 20");
  });

  test("enforces forty questions per guild per hour", () => {
    for (let index = 0; index < 40; index++) {
      consume(identityFor(index), 1000);
    }
    const rejected = tryStartBucksAsk(identityFor(41), 1000);
    expect(rejected.allowed).toBe(false);
    if (rejected.allowed) throw new Error("expected the guild request to fail");
    expect(rejected.reason).toContain("40 of 40");
  });

  test("allows two global runs but not a third and releases slots", () => {
    const first = tryStartBucksAsk(identityFor(1), 1000);
    const second = tryStartBucksAsk(identityFor(2), 1000);
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    if (!first.allowed || !second.allowed) {
      throw new Error("expected two active slots");
    }
    expect(getBucksAskQuotaStatus(identityFor(1), 1000).activeGlobalRuns).toBe(
      2,
    );
    const third = tryStartBucksAsk(identityFor(3), 1000);
    expect(third.allowed).toBe(false);

    first.finish();
    const replacement = tryStartBucksAsk(identityFor(3), 1000);
    expect(replacement.allowed).toBe(true);
    if (replacement.allowed) replacement.finish();
    second.finish();
  });

  test("does not anchor quota windows for concurrency rejections", () => {
    const first = tryStartBucksAsk(identityFor(1), 1000);
    const second = tryStartBucksAsk(identityFor(2), 1000);
    if (!first.allowed || !second.allowed) {
      throw new Error("expected two active slots");
    }
    const identity = identityFor(3);
    expect(tryStartBucksAsk(identity, 1000).allowed).toBe(false);

    first.finish();
    consume(identity, 60_000);
    consume(identity, 60_000);

    const rejected = tryStartBucksAsk(identity, 61_001);
    expect(rejected.allowed).toBe(false);
    if (rejected.allowed) {
      throw new Error("expected the successful-request window to remain full");
    }
    expect(rejected.reason).toContain("2 of 2");
    expect(rejected.retryAfterSeconds).toBe(59);
    second.finish();
  });
});

function identityFor(index: number): BucksAskRateLimitIdentity {
  return { userId: bucksTestDiscordId(index), serverId: SERVER };
}

function consume(identity: BucksAskRateLimitIdentity, now: number): void {
  const ticket = tryStartBucksAsk(identity, now);
  if (!ticket.allowed) {
    throw new Error(ticket.reason);
  }
  ticket.commit();
  ticket.finish();
}
