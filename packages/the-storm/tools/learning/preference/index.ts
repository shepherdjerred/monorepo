import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { reviewEligibility } from "./eligibility.ts";
import { preferenceSchedule } from "./gate.ts";
import contract from "./contract.json";
import { PreferenceLedger, digestFile } from "./ledger.ts";
import { blindVideo, run } from "./media.ts";
import { root } from "#learning/sandbox.ts";
import type { DuelState } from "#learning/duels.ts";
import { verifyNativeCaptures } from "#learning/native/verify.ts";

const args = parseArgs({
  allowPositionals: true,
  options: {
    pilot: { type: "string" },
    evaluation: { type: "string" },
    model: { type: "string" },
    clips: { type: "string" },
    output: { type: "string" },
    answers: { type: "string" },
  },
  strict: true,
});
const action = z
  .enum(["schedule", "prepare", "score", "verify"])
  .parse(args.positionals[0]);
if (args.positionals.length !== 1)
  throw new Error(
    "preference needs one schedule, prepare, score or verify action",
  );
const required = (value: string | undefined) =>
  path.resolve(z.string().min(1).parse(value));
const pilot = required(args.values.pilot);
const claimFile = path.join(pilot, "blind-preference.claimed.json");

switch (action) {
  case "schedule": {
    if (
      [args.values.output, args.values.clips, args.values.answers].some(
        (value) => value !== undefined,
      )
    )
      throw new Error(
        "schedule prints capture metadata; provide only pilot, evaluation and model",
      );
    const eligible = await reviewEligibility(
      pilot,
      required(args.values.evaluation),
      required(args.values.model),
    );
    process.stdout.write(
      JSON.stringify(
        {
          version: 1,
          engine: "Paper",
          acceptance: "unaccepted",
          actor_sha256: eligible.actor_sha256,
          native_sha256: eligible.native_sha256,
          retries: 0,
          window: contract.window,
          video: contract.video,
          schedule: preferenceSchedule().map((match) => ({
            ...match,
            learned: `rwfinfer begin ${match.seed.toString()} ${match.side} authored`,
            authored: `rwflearn begin ${match.seed.toString()} ${match.side} authored authored`,
          })),
        },
        null,
        2,
      ) + "\n",
    );
    break;
  }
  case "prepare": {
    const output = required(args.values.output);
    if (args.values.answers !== undefined)
      throw new Error("prepare does not accept answers");
    const clipsFile = required(args.values.clips);
    const eligible = await reviewEligibility(
      pilot,
      required(args.values.evaluation),
      required(args.values.model),
    );
    const verified = await verifyNativeCaptures(pilot, eligible, clipsFile);
    const captures = verified.captures;
    if (
      captures.actor_sha256 !== eligible.actor_sha256 ||
      captures.native_sha256 !== eligible.native_sha256
    )
      throw new Error(
        "preference captures use a different actor or native runtime",
      );
    const files = new Map(
      [...eligible.files, ...verified.files].map((file) => [
        file.file,
        file.sha256,
      ]),
    );
    const snapshot = async (file: string) => {
      const resolved = path.resolve(path.dirname(clipsFile), file);
      files.set(resolved, await digestFile(resolved));
      return resolved;
    };
    await snapshot(clipsFile);
    const pairs = [];
    const recordings: string[] = [];
    const states: DuelState[] = [];
    for (const pair of captures.pairs) {
      const learned = await snapshot(pair.learned.video);
      const authored = await snapshot(pair.authored.video);
      for (const clip of [pair.learned, pair.authored]) {
        recordings.push(await snapshot(clip.recording));
        states.push(clip.state);
      }
      pairs.push({ pair: pair.pair, learned, authored });
    }
    const recordGroups = await Promise.all(
      recordings.map(async (file, index) => {
        const state = states[index];
        if (state === undefined)
          throw new Error("preference recording has no capture state");
        return z
          .array(z.unknown())
          .length(1)
          .parse(
            JSON.parse(
              await run([
                "python3",
                path.join(
                  root,
                  "scripts/bots/learning/preference_recording.py",
                ),
                "--expected-seed",
                state.seed.toString(),
                file,
              ]),
            ),
          );
      }),
    );
    const rawRecords: unknown = recordGroups.flat();
    const records = z
      .array(
        z
          .object({
            match: z.uuid(),
            map_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
            winner: z.enum(["RED", "BLUE", "-"]),
            reason: z.enum(["LAST_TEAM_STANDING", "DRAW", "STOPPED"]),
          })
          .strict(),
      )
      .length(40)
      .parse(rawRecords);
    for (const [index, record] of records.entries()) {
      const state = states[index];
      const won = record.winner.toLowerCase() === state?.side;
      if (
        record.match !== state?.match ||
        (!won && state.result === "win") ||
        (state.result === "loss" && (won || record.winner === "-")) ||
        (["draw", "timeout"].includes(state.result) && record.winner !== "-")
      )
        throw new Error(
          "preference native recording differs from capture evidence",
        );
    }
    if (new Set(records.map((record) => record.map_sha256)).size !== 1)
      throw new Error("preference footage uses different native terrain");
    for (const name of ["ffmpeg", "ffprobe"]) {
      const executable = Bun.which(name);
      if (executable === null)
        throw new Error(`required media tool is missing: ${name}`);
      await snapshot(executable);
      await run([name, "-version"]);
    }
    const ledger = await PreferenceLedger.create(output, claimFile, {
      version: 1,
      actor_sha256: eligible.actor_sha256,
      files: Array.from(files, ([file, sha256]) => ({ file, sha256 })),
      pairs,
    });
    await ledger.pack(blindVideo);
    console.warn(
      `Review ready: ${path.join(output, "public/review.json")}. Give only the public directory to the reviewer.`,
    );
    break;
  }
  case "verify": {
    if (
      [
        args.values.evaluation,
        args.values.model,
        args.values.clips,
        args.values.answers,
      ].some((value) => value !== undefined)
    )
      throw new Error(
        "verify rereads the sealed ballot; provide only pilot and output",
      );
    const ledger = await PreferenceLedger.read(
      required(args.values.output),
      claimFile,
    );
    const verified = await ledger.verifyResult();
    process.stdout.write(JSON.stringify(verified.result, null, 2) + "\n");
    if (!verified.result.passed) process.exitCode = 1;
    break;
  }
  case "score": {
    const output = required(args.values.output);
    if (
      [args.values.evaluation, args.values.model, args.values.clips].some(
        (value) => value !== undefined,
      )
    )
      throw new Error(
        "score uses the frozen review inputs; provide only pilot, output and answers",
      );
    const ledger = await PreferenceLedger.read(output, claimFile);
    const result = await ledger.score(required(args.values.answers));
    console.warn(JSON.stringify(result));
    if (!result.passed) process.exitCode = 1;
    break;
  }
}
