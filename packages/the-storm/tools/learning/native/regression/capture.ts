import { mkdir, open, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { openPaperDuels } from "#learning/sandbox.ts";
import { buildCaptureInputs, captureInputs } from "#learning/native/inputs.ts";
import {
  RegressionClient,
  type RegressionSample,
} from "#learning/native/regression-client.ts";
import {
  regressionJournal,
  type RegressionCommand,
} from "#learning/native/regression-gate.ts";
import { jsonText, seal } from "#learning/preference/ledger.ts";

export const drained = (state: RegressionSample) =>
  state.inference !== null &&
  state.inference.submitted ===
    state.inference.deadlineMet + state.inference.deadlineMissed;

type Paper = Awaited<ReturnType<typeof openPaperDuels>>;
export type Capture = {
  paper: Paper;
  fixture: RegressionClient;
  cleanup: (() => Promise<void>)[];
  save: (name: string, value: unknown) => Promise<void>;
};

export async function waitForPhase(
  fixture: RegressionClient,
  phase: RegressionSample["phase"],
  deadline: number,
  message: string,
) {
  let state = await fixture.command("sample");
  while (state.phase !== phase) {
    if (Date.now() >= deadline) throw new Error(message);
    await Bun.sleep(100);
    state = await fixture.command("sample");
  }
  return state;
}

/** One owned original case; callers can never reuse a directory or reroll a failed case. */
export async function captureRegression(
  options: {
    model: string;
    output: string;
    caseName: string;
    bots: number;
    profile: "regression" | "regression-player";
  },
  scenario: (capture: Capture) => Promise<void>,
) {
  const { model, output, caseName, bots, profile } = options;
  await buildCaptureInputs();
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(output, { recursive: false, mode: 0o700 });
  const save = (name: string, value: unknown) =>
    seal(path.join(output, name), jsonText(value));
  try {
    const inputs = await captureInputs(model);
    await save("inputs.json", {
      schema: 1,
      acceptance: "unaccepted",
      diagnostic: true,
      inputs,
      retries: 0,
    });
    const commands: RegressionCommand[] = [];
    const paper = await openPaperDuels(output, model, profile);
    let raw: FileHandle | undefined;
    const cleanup: (() => Promise<void>)[] = [];
    const errors: unknown[] = [];
    try {
      raw = await open(path.join(output, "commands.jsonl"), "wx", 0o600);
      const writer = raw;
      const fixture = new RegressionClient(
        paper.console,
        async (command, state) => {
          await writer.write(JSON.stringify({ command, state }) + "\n");
          await writer.sync();
          commands.push({ command, state });
        },
      );
      await fixture.load();
      await fixture.command(`arm ${caseName} ${bots.toString()}`);
      await scenario({ paper, fixture, cleanup, save });
      const deadline = Date.now() + 16 * 60_000;
      let state = await fixture.command("sample");
      while (!["ended", "stopped"].includes(state.result) || !drained(state)) {
        if (Date.now() >= deadline)
          throw new Error("Original native regression did not finish");
        await Bun.sleep(250);
        state = await fixture.command("sample");
      }
      await fixture.command("release");
    } catch (error) {
      errors.push(error);
    }
    for (const close of [
      async () => raw?.close(),
      ...cleanup.toReversed(),
      paper.stop,
    ]) {
      try {
        await close();
      } catch (error) {
        errors.push(error);
      }
    }
    const first = errors[0];
    if (errors.length === 1 && first instanceof Error) throw first;
    if (errors.length > 0)
      throw new AggregateError(
        errors,
        "Native regression capture or cleanup failed",
      );
    if (JSON.stringify(await captureInputs(model)) !== JSON.stringify(inputs))
      throw new Error(
        "Native regression actor, environment or recorder changed",
      );
    return { measured: regressionJournal(commands, caseName), inputs };
  } catch (error) {
    await save("failure.json", {
      schema: 1,
      acceptance: "unaccepted",
      diagnostic: true,
      retries: 0,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
