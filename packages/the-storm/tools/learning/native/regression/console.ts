import { open } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Capture } from "./capture.ts";
import type { RegressionCommand } from "#learning/native/regression-gate.ts";

export const NativeCommand = z.strictObject({
  sequence: z.number().int().positive(),
  key: z.string().min(1),
  command: z.string().min(1),
  response: z.string(),
  startSequence: z.number().int().nonnegative(),
  startPhase: z.string().min(1),
  endSequence: z.number().int().nonnegative(),
  endPhase: z.string().min(1),
});
export type NativeCommand = z.infer<typeof NativeCommand>;

/** Native console responses durably bracketed by the same original regression journal. */
export async function openNativeConsole(capture: Capture, output: string) {
  const raw = await open(
    path.join(output, "native-commands.jsonl"),
    "wx",
    0o600,
  );
  capture.cleanup.push(async () => raw.close());
  let sequence = 0;
  return async (key: string, command: string) => {
    const start = await capture.fixture.command("sample");
    const response = await capture.paper.console.command(command);
    const end = await capture.fixture.command("sample");
    const row = NativeCommand.parse({
      sequence: ++sequence,
      key,
      command,
      response,
      startSequence: start.sequence,
      startPhase: start.phase,
      endSequence: end.sequence,
      endPhase: end.phase,
    });
    await raw.write(JSON.stringify(row) + "\n");
    await raw.sync();
    return row;
  };
}

export function nativeCommands(
  raw: unknown,
  journal: RegressionCommand[],
  match: string,
  caseName: string,
) {
  const rows = z.array(NativeCommand).min(1).max(64).parse(raw);
  let previous = 0;
  for (const [index, row] of rows.entries()) {
    if (
      row.sequence !== index + 1 ||
      row.startSequence < previous ||
      row.endSequence < row.startSequence
    )
      throw new Error(
        "Native command journal lost or reordered original requests",
      );
    for (const [sequence, phase] of [
      [row.startSequence, row.startPhase],
      [row.endSequence, row.endPhase],
    ] as const)
      if (
        !journal.some(
          (entry) =>
            entry.state.caseName === caseName &&
            entry.state.match === match &&
            entry.state.sequence === sequence &&
            entry.state.phase === phase,
        )
      )
        throw new Error("Native command lacks its original case checkpoint");
    previous = row.endSequence;
  }
  return rows;
}
