import { appendFile, mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { packageRoot } from "#e2e/harness/paths.ts";
import { eventually } from "#e2e/harness/rwf-match.ts";
import type { RconClient } from "#e2e/harness/rcon.ts";
import { request, StatusSchema, type Session } from "#client/protocol.ts";
import { CapacityCombatCapture } from "./native-combat.ts";

/** The fixture replies with a JSON boolean, never a truthy string or status object. */
export function candidateReady(reply: string): boolean {
  return z.boolean().parse(JSON.parse(reply));
}

/** Observe terrain completion; leave the cold ballot and first-arrival vote untouched. */
export async function awaitNativeCandidate(
  rcon: Pick<RconClient, "command">,
  mapId: string,
) {
  const root = path.join(packageRoot, ".cache/e2e/capacity-native-preparation");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const artifacts = await mkdtemp(path.join(root, "candidate-"));
  const replies = path.join(artifacts, "replies.jsonl");
  console.warn(`Native candidate preparation evidence: ${artifacts}`);
  const observed = {
    async command(command: string) {
      const requestedAt = Date.now();
      const reply = await rcon.command(command);
      await appendFile(
        replies,
        `${JSON.stringify({ requestedAt, receivedAt: Date.now(), command, reply })}\n`,
      );
      return reply;
    },
  };
  const method = `storm-fixture-map-lifecycle candidate-ready ${mapId}`;
  const startedAt = Date.now();
  await eventually(
    "the cold candidate terrain to finish preparing in an empty lobby",
    async () => {
      await observed.command("rwf admin status");
      return candidateReady(await observed.command(method));
    },
    15 * 60_000,
  );
  const readyAt = Date.now();
  const preparation = {
    mapId,
    method,
    startedAt,
    readyAt,
    elapsedMs: readyAt - startedAt,
    replies,
  };
  await Bun.write(
    path.join(artifacts, "preparation.json"),
    JSON.stringify(preparation, null, 2),
  );
  return { preparation, observed };
}

/** Passive failure evidence only: a journal is bound to the successfully armed match. */
export async function retainNativeCombatFailure(
  rcon: Pick<RconClient, "command">,
  artifacts: string,
  match: string,
) {
  const diagnostics: Record<string, unknown> = {
    requestedAt: Date.now(),
    command: "rwfcapacitycombat sample",
    match,
  };
  try {
    const reply = await rcon.command("rwfcapacitycombat sample");
    diagnostics["receivedAt"] = Date.now();
    diagnostics["reply"] = reply;
    const capture = CapacityCombatCapture.parse(JSON.parse(reply));
    if (capture.match !== match)
      throw new Error("Failure combat observer belongs to another armed match");
    diagnostics["capture"] = capture;
  } catch (error) {
    diagnostics["captureFailure"] = String(error);
  }
  try {
    await Bun.write(
      path.join(artifacts, "combat-failure.json"),
      JSON.stringify(diagnostics, null, 2),
    );
  } catch (error) {
    console.warn(`Failed to retain native combat evidence: ${String(error)}`);
  }
}

/** Secondary evidence failures must not replace the original acceptance failure. */
export async function retainNativeFailure(session: Session, failure: unknown) {
  const diagnostics: Record<string, unknown> = {
    at: Date.now(),
    failure: String(failure),
  };
  try {
    const state = StatusSchema.parse(await request(session, "status"));
    diagnostics["state"] = state;
    if (state.connected) {
      diagnostics["capture"] = await request(session, "capture", {
        name: "native-failure",
      });
    }
  } catch (error) {
    diagnostics["captureFailure"] = String(error);
  }
  try {
    await Bun.write(
      path.join(session.artifacts, "failure.json"),
      JSON.stringify(diagnostics, null, 2),
    );
  } catch (error) {
    console.warn(`Failed to retain native failure evidence: ${String(error)}`);
  }
}
