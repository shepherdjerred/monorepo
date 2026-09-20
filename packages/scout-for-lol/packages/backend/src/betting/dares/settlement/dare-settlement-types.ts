import type { BucksDareHorizonKind } from "@scout-for-lol/data";
import type {
  DareContributorRefund,
  DareTargetPayout,
} from "#src/betting/dares/settlement/dare-ledger.ts";

/**
 * What a settled Dare looks like, for everything that describes one without
 * performing one.
 *
 * Here rather than beside the settling code because that is what the
 * dependency graph says: the copy module, the delivery arm and the
 * announcement sink all need to talk about a resolved Dare, and none of them
 * settles anything. With the type next to the machinery, presentation
 * depended on settlement, settlement's own shared module depended on the
 * sink, and the sink depended on delivery — a loop closed entirely by
 * modules that only wanted to name a shape.
 *
 * Third time this shape has bitten on this branch, after the straight-pool
 * summary and the parlay one. A type that many modules need and few produce
 * belongs with the other descriptions.
 */

export type DareResolution =
  "captured" | "achieved" | "unachieved" | "voided" | "expired" | "abandoned";

/**
 * What one dare resolution (or progress capture) looked like, for the
 * Discord delivery layer to announce. The domain stays Discord-free: it
 * returns these and never sends anything.
 */
export type DareSettlementSummary = {
  dareId: number;
  serverId: string;
  channelId: string;
  /** JSON BucksMessageRef for the public callout, when one was recorded. */
  messageRef: string | null;
  matchId: string | undefined;
  resolution: DareResolution;
  horizonKind: BucksDareHorizonKind;
  challengerDiscordId: string;
  targetAliases: string[];
  conditionSummary: string;
  potTotal: number;
  /** Per-target payouts — populated only for `achieved`. */
  payouts: DareTargetPayout[];
  /** Per-contributor refunds — populated for `unachieved`, `voided`, and
   * `expired`. */
  refunds: DareContributorRefund[];
  voidReason: string | undefined;
  /** Per-leaf qualifying-game counts after this capture, canonical order. */
  leafCounts: number[] | undefined;
};
