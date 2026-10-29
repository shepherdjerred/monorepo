import { expect, test } from "vitest";
import {
  TorrentPolicySchema,
  TorrentRatioSchema,
  hasApplicationSeedingPolicy,
} from "./qbittorrent-policy.ts";
import { evaluateSeeding } from "#domain/seeding.ts";

const policy = {
  ratio_limit: -1,
  seeding_time_limit: -1,
  inactive_seeding_time_limit: -1,
  max_ratio: -1,
  max_seeding_time: -1,
  max_inactive_seeding_time: -1,
  share_limit_action: "Stop" as const,
  auto_tmm: false,
  force_start: false,
};

test("infinite qBit ratio survives JSON and satisfies ratio without bypassing time obligations", () => {
  const ratio = TorrentRatioSchema.parse(-1);
  const encoded = JSON.stringify(ratio);
  expect(JSON.parse(encoded)).toEqual({ kind: "infinite" });
  expect(TorrentRatioSchema.parse(0)).toEqual({ kind: "finite", value: 0 });
  expect(() => TorrentRatioSchema.parse(-2)).toThrow();
  expect(() => TorrentRatioSchema.parse(Infinity)).toThrow();
  const observed = {
    ratio: { kind: "infinite" as const },
    seedingSeconds: 1,
    sizeBytes: 1000,
    complete: true,
    owned: true,
    dependenciesRemaining: false,
  };
  expect(evaluateSeeding({ kind: "public" }, observed).eligible).toBe(true);
  expect(
    evaluateSeeding(
      {
        kind: "private",
        verified: true,
        ratio: 10,
        minimumSeconds: 60,
        combination: "all",
        sizeRule: null,
      },
      observed,
    ).eligible,
  ).toBe(false);
});

test("each inherited, effective, action, or management drift protects application transfers", () => {
  expect(hasApplicationSeedingPolicy(TorrentPolicySchema.parse(policy))).toBe(
    true,
  );
  for (const patch of [
    { ratio_limit: -2 },
    { seeding_time_limit: 60 },
    { inactive_seeding_time_limit: 1 },
    { max_ratio: 1 },
    { max_seeding_time: 60 },
    { max_inactive_seeding_time: 1 },
    { share_limit_action: "Default" },
    { share_limit_action: "RemoveWithContent" },
    { auto_tmm: true },
    { force_start: true },
  ])
    expect(
      hasApplicationSeedingPolicy(
        TorrentPolicySchema.parse({ ...policy, ...patch }),
      ),
    ).toBe(false);
  const minutes = TorrentPolicySchema.parse({
    ...policy,
    seeding_time_limit: 60,
    max_seeding_time: 60,
  });
  expect(minutes.max_seeding_time).toBe(60);
  expect(() =>
    TorrentPolicySchema.parse({ ...policy, max_ratio: undefined }),
  ).toThrow();
});
