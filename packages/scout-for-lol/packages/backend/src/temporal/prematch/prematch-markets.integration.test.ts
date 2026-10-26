import {
  openPrematchMarkets,
  prematchMarketsEvidenceCodec,
} from "#src/temporal/prematch/prematch-markets.ts";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { expect, test } from "vitest";

test("a retained market Activity is a terminal no-op on every retry", async () => {
  const input = { riotMatchId: RiotMatchIdSchema.parse("NA1_7100000001") };
  const expected = {
    guard: { outcome: "already-applied" },
    fact: { outcome: "already-applied" },
    effects: 0,
  };
  expect(await openPrematchMarkets(input)).toEqual(expected);
  expect(await openPrematchMarkets(input)).toEqual(expected);
});
test("retained receipts still decode without reopening a market", () => {
  const envelope = {
    kind: "prematch-markets-evidence",
    version: 1,
    data: { market: "betting-pools", guildIds: ["1337623164146155593"] },
  };
  expect(prematchMarketsEvidenceCodec.parse(envelope)).toEqual(envelope.data);
});
