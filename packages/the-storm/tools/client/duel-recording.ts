import type { DuelClient, DuelState } from "#learning/duels.ts";
import { validateDuelClock } from "./duel-clock.ts";
import { validateDuelFrames } from "./duel-video.ts";
import { request, waitFor } from "./protocol.ts";
import type { Session } from "./protocol.ts";
import { VideoStatus } from "./video-frames.ts";
import { encodeVideo } from "./video.ts";
import { z } from "zod";

/** One original match attempt; full outcomes outlive the first-600-tick pixel window. */
export async function recordDuel(options: {
  session: Session;
  duels: DuelClient;
  name: string;
  expected: {
    seed: number;
    side: "red" | "blue";
    mode: "authored" | "external";
    opponent: "authored" | "basic";
  };
  begin: () => Promise<unknown>;
}) {
  const { session, duels, name, expected, begin } = options;
  await request(session, "duel-arm", { name, ...expected });
  await request(session, "video-duel-arm", {
    name: `${name}-frames`,
    fov: 70,
    ...expected,
  });
  await waitFor(
    "settled native model camera",
    async () => VideoStatus.parse(await request(session, "video-status")),
    (value) => value.state === "READY",
  );
  await begin();
  const began = await duels.command("state");
  const results = await Promise.allSettled([
    waitFor(
      "native model 900-frame window",
      async () => {
        const status = VideoStatus.parse(
          await request(session, "video-status"),
        );
        if (status.state === "FAILED") throw new Error(status.error);
        return status;
      },
      (value) => value.state === "COMPLETE",
      45_000,
    ),
    duels.waitFor(
      (value) => !["waiting", "live"].includes(value.result),
      90_000,
    ),
  ]);
  const rendered = results[0];
  const completed = results[1];
  if (rendered.status === "rejected") throw rendered.reason;
  if (completed.status === "rejected") throw completed.reason;
  const terminal = completed.value;
  const framesFile = rendered.value.receipt;
  const frames = validateDuelFrames(await Bun.file(framesFile).json());
  const clockFile = z.string().parse(await request(session, "duel-seal"));
  const clock = validateDuelClock(await Bun.file(clockFile).json());
  const last = clock.entries.at(-1)?.marker;
  const matchesContext = (state: DuelState) =>
    state.seed === expected.seed &&
    state.side === expected.side &&
    state.mode === expected.mode &&
    state.opponent === expected.opponent;
  if (
    !matchesContext(began) ||
    !matchesContext(terminal) ||
    !["win", "loss", "draw", "timeout"].includes(terminal.result) ||
    last?.match !== began.match ||
    last.match !== terminal.match ||
    last.result !== terminal.result ||
    last.tick !== terminal.sampleTick
  )
    throw new Error(
      "Native model pixels differ from the original match outcome",
    );
  const fullStart = clock.entries[1]?.receivedElapsedNanos;
  if (fullStart === undefined)
    throw new Error("Native model clock has no live anchor");
  frames.duel.clock.entries.forEach((entry, index) => {
    const full = clock.entries[index];
    if (
      full === undefined ||
      JSON.stringify(entry.marker) !== JSON.stringify(full.marker) ||
      entry.receivedElapsedNanos - frames.duel.startedElapsedNanos !==
        full.receivedElapsedNanos - fullStart
    )
      throw new Error(
        "Native model clip differs from the separate original clock",
      );
  });
  const video = await encodeVideo(framesFile);
  if (!video.native_window_bound)
    throw new Error("Native model video lost its clock binding");
  return { state: terminal, framesFile, clockFile, frames, video };
}
