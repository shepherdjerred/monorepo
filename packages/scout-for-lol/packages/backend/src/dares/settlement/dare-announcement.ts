import { withholdDareCallout } from "#src/dares/presentation/dare-callout-refresh-state.ts";
import { enqueueTerminalDareNotification } from "#src/dares/presentation/notify/dare-notification-production.ts";
import {
  mintDareResultIntent,
  type DareNotificationDisposition,
} from "#src/dares/presentation/notify/dare-status-intent.ts";
import type { DareProof } from "#src/dares/settlement/dare-settle-types.ts";
import type { Db } from "#src/database/index.ts";
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";

export async function announceOrWithholdDare(
  tx: Db,
  input: { dareId: number; notify: DareNotificationDisposition },
  enqueue: () => Promise<void>,
): Promise<void> {
  if (input.notify === "withhold") {
    await withholdDareCallout(tx, input.dareId);
    return;
  }
  await enqueue();
}

/** Freeze results in the same transaction as the terminal transition. */
export async function recordTerminalDareAnnouncement(
  tx: Db,
  input: {
    dare: {
      id: number;
      challengerDiscordId: string;
      targets: readonly {
        targetKey: string;
        discordId: string;
        alias: string;
      }[];
    };
    contract: { revision: number; plainLanguage: string };
    proof: DareProof | null;
    matchId?: RiotMatchId | undefined;
    now: Date;
    notify: DareNotificationDisposition;
  },
  resolution: "achieved" | "unachieved" | "voided",
): Promise<void> {
  const proof = input.proof;
  if (
    resolution === "achieved" &&
    (proof === null || !proof.value || proof.targetKeys.length === 0)
  ) {
    throw new Error("An achieved Dare requires decisive target evidence.");
  }
  await announceOrWithholdDare(
    tx,
    { dareId: input.dare.id, notify: input.notify },
    async () => {
      await enqueueTerminalDareNotification(tx, {
        dareId: input.dare.id,
        revision: input.contract.revision,
        resolution,
        matchId: input.matchId,
        now: input.now,
      });
      await mintDareResultIntent(tx, {
        dareId: input.dare.id,
        revision: input.contract.revision,
        result: {
          resolution,
          challengerDiscordId: DiscordAccountIdSchema.parse(
            input.dare.challengerDiscordId,
          ),
          plainLanguage: input.contract.plainLanguage,
          winners:
            resolution === "achieved"
              ? input.dare.targets
                  .filter(
                    (target) =>
                      proof?.targetKeys.includes(target.targetKey) === true,
                  )
                  .map((target) => ({
                    discordId: DiscordAccountIdSchema.parse(target.discordId),
                    alias: target.alias,
                  }))
              : [],
          voidReason: resolution === "voided" ? "missing_evidence" : null,
        },
        matchId: input.matchId,
        occurredAt: input.now,
      });
    },
  );
}
