import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { DuelClient } from "#learning/duels.ts";
import type { DuelState } from "#learning/duels.ts";
import type { RconClient } from "#e2e/harness/rcon.ts";
import { DuelClockStatus, validateDuelClock } from "./duel-clock.ts";
import { request, StatusSchema, waitFor } from "./protocol.ts";
import type { Session } from "./protocol.ts";

const Observer = z.strictObject({
  observer: z.string(),
  active: z.boolean(),
  match: z.string(),
  error: z.string(),
});

async function command(rcon: RconClient, text: string) {
  const response = await rcon.command(`rwfcapture ${text}`);
  const raw: unknown = JSON.parse(response.trim());
  const error = z.strictObject({ error: z.string() }).safeParse(raw);
  if (error.success) throw new Error(error.data.error);
  return Observer.parse(raw);
}

function offlineObserverId(): string {
  const bytes = createHash("md5").update("OfflinePlayer:StormPreview").digest();
  bytes[6] = (bytes.readUInt8(6) & 0x0f) | 0x30;
  bytes[8] = (bytes.readUInt8(8) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return z
    .uuid()
    .parse(
      `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
    );
}

async function arm(
  session: Session,
  expected: {
    seed: number;
    side: "red" | "blue";
    mode: "authored" | "external";
    name: string;
  },
) {
  const status = DuelClockStatus.parse(
    await request(session, "duel-arm", { ...expected, opponent: "basic" }),
  );
  if (status.state !== "ARMED" || status.markers !== 0 || status.error !== "")
    throw new Error("Native duel clock did not arm cleanly");
}

async function seal(
  session: Session,
  state: DuelState,
  expectedMatch = state.match,
) {
  const status = await waitFor(
    "native duel terminal marker",
    async () => {
      const value = DuelClockStatus.parse(
        await request(session, "duel-status"),
      );
      if (value.state === "FAILED") throw new Error(value.error);
      return value;
    },
    (value) => value.state === "TERMINAL",
    5000,
  );
  const file = z.string().parse(await request(session, "duel-seal"));
  if (file !== status.receipt)
    throw new Error("Native clock seal path changed");
  const receipt = validateDuelClock(await Bun.file(file).json());
  const first = receipt.entries[0]?.marker;
  const last = receipt.entries.at(-1)?.marker;
  if (
    first?.match !== expectedMatch ||
    (state.match !== "" && state.match !== expectedMatch) ||
    last?.result !== state.result ||
    receipt.expected.seed !== state.seed ||
    receipt.expected.side !== state.side ||
    receipt.expected.mode !== state.mode ||
    receipt.expected.opponent !== state.opponent ||
    (last.elapsed >= 0 && last.tick !== state.sampleTick)
  )
    throw new Error(
      "Native receiver clock differs from the original terminal duel state",
    );
  return {
    file,
    sha256: createHash("sha256")
      .update(new Uint8Array(await Bun.file(file).arrayBuffer()))
      .digest("hex"),
    state,
    markers: receipt.entries.length,
    firstLiveTick: receipt.entries[1]?.marker.tick,
    terminalElapsed: last.elapsed,
  };
}

/** Actual Paper + ordinary native client, with no learned policy or human acceptance claims. */
export async function verifyDuelClock(
  session: Session,
  rcon: RconClient,
): Promise<void> {
  const duels = new DuelClient(rcon);
  const id = offlineObserverId();
  const evidence: Record<string, unknown> = {};
  await rcon.command(
    "execute in minecraft:rwf run tp StormPreview 31.5 84 25.5 180 40",
  );
  await waitFor(
    "observer training-yard world",
    async () => StatusSchema.parse(await request(session, "status")),
    (state) =>
      state.connected &&
      state.world === "minecraft:rwf" &&
      Math.abs(state.position[1] - 84) < 1,
  );
  // The preview initially uses creative. Refusing it proves observation cannot enroll a combatant.
  let refused = false;
  try {
    await command(rcon, `observe ${id}`);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.includes("unrostered spectator")
    )
      throw error;
    refused = true;
  }
  if (!refused)
    throw new Error("Creative observer was admitted to the duel transport");
  await rcon.command("gamemode spectator StormPreview");
  await Bun.sleep(300);
  const observer = await command(rcon, `observe ${id}`);
  if (observer.observer !== id || observer.active || observer.error !== "")
    throw new Error("Native observer enrollment changed");
  try {
    await arm(session, {
      seed: 600_100_000,
      side: "red",
      mode: "authored",
      name: "native-duel-outcome",
    });
    const began = await duels.command("begin 600100000 red authored basic");
    await duels.waitFor((state) => state.result === "live", 15_000);
    await request(session, "capture", { name: "native-duel-clock-first-live" });
    await duels.waitFor(
      (state) => state.result === "live" && (state.elapsed ?? 0) >= 30,
      5000,
    );
    await request(session, "capture", { name: "native-duel-clock-live" });
    const terminal = await duels.waitFor(
      (state) => !["waiting", "live"].includes(state.result),
      90_000,
    );
    if (
      began.match !== terminal.match ||
      !["win", "loss", "draw", "timeout"].includes(terminal.result)
    )
      throw new Error("Native diagnostic duel stopped unexpectedly");
    evidence["completedDuel"] = await seal(session, terminal);
    await duels.waitFor((state) => state.phase === "LOBBY", 15_000);

    await arm(session, {
      seed: 600_100_001,
      side: "blue",
      mode: "external",
      name: "native-countdown-cancel",
    });
    const countdown = await duels.command(
      "begin 600100001 blue external basic",
    );
    await waitFor(
      "countdown begin marker",
      async () => DuelClockStatus.parse(await request(session, "duel-status")),
      (state) => state.state === "WAITING",
      5000,
    );
    const cancelled = await duels.command("cancel");
    const cancellation = await seal(session, cancelled, countdown.match);
    if (cancellation.terminalElapsed !== -1 || cancellation.markers !== 2)
      throw new Error("Countdown cancellation invented live ticks");
    evidence["cancelledCountdown"] = cancellation;
    await duels.waitFor((state) => state.phase === "LOBBY", 15_000);

    await arm(session, {
      seed: 600_100_002,
      side: "red",
      mode: "authored",
      name: "native-observer-invalidated",
    });
    await duels.command("begin 600100002 red authored basic");
    const live = await duels.waitFor(
      (state) => state.result === "live" && (state.elapsed ?? 0) >= 2,
      15_000,
    );
    await rcon.command("gamemode creative StormPreview");
    const failed = await waitFor(
      "invalid observer rejection",
      async () => DuelClockStatus.parse(await request(session, "duel-status")),
      (state) => state.state === "FAILED",
      5000,
    );
    const advanced = await duels.waitFor(
      (state) => state.sampleTick > live.sampleTick + 2,
      5000,
    );
    const broken = await command(rcon, "state");
    if (broken.error === "" || advanced.result !== "live")
      throw new Error(
        "Losing the observer interrupted native combat or retained valid evidence",
      );
    const failedFile = z.string().parse(await request(session, "duel-seal"));
    let rejected = false;
    try {
      validateDuelClock(await Bun.file(failedFile).json());
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("Invalidated observer receipt was accepted");
    evidence["invalidatedObserver"] = {
      file: failedFile,
      error: failed.error,
      serverError: broken.error,
      beforeTick: live.sampleTick,
      afterTick: advanced.sampleTick,
    };
  } finally {
    await duels.command("cancel");
    await command(rcon, "clear");
  }
  await writeFile(
    path.join(session.artifacts, "duel-clock-verification.json"),
    `${JSON.stringify(
      {
        schema: 1,
        kind: "rwf-native-duel-clock-verification",
        acceptance: "unaccepted",
        source: "paper-and-native-client",
        observer: id,
        observerRejectedCreative: refused,
        evidence,
        clipWindowBound: false,
        terminalFrameHeld: false,
        modelSpecific: false,
        humanPreferenceMeasured: false,
        rolloutEnabled: false,
      },
      null,
      2,
    )}\n`,
    { flag: "wx" },
  );
}
