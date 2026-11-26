import {
  ActorSchema,
  type ActorEnvelope,
} from "@shepherdjerred/tracker/contract";
import { HerdrClient, type AgentCommandRunner } from "./herdr.ts";

/**
 * Best-effort Herdr stamp for Tracker actor metadata: the terminal's own
 * address plus its Herdr space/tab labels, read live from hc at mutation
 * time. Any failure (no hc, not under Herdr, timeout) leaves the actor
 * unchanged — stamping must never fail a Tracker write.
 */
export async function enrichActorWithHerdr(
  actor: ActorEnvelope,
  env: Readonly<Record<string, string | undefined>>,
  run?: AgentCommandRunner,
): Promise<ActorEnvelope> {
  const terminal = env["HC_TERMINAL_ID"];
  if (terminal === undefined || terminal === "") return actor;
  try {
    const detail = await new HerdrClient(run).get(terminal);
    if (detail === null) return actor;
    return ActorSchema.parse({
      ...actor,
      metadata: {
        ...actor.metadata,
        hcAddress: detail.address,
        ...(detail.space === null ? {} : { herdrSpace: detail.space }),
        ...(detail.tab === null ? {} : { herdrTab: detail.tab }),
      },
    });
  } catch {
    return actor;
  }
}
