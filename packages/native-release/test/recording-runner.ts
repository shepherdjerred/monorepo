import type {
  CommandResult,
  ProcessRunner,
} from "@shepherdjerred/native-release/runner";

type Reply = Partial<CommandResult>;

/** A runner that records every command and answers from `reply`; nothing is ever spawned. */
export function recordingRunner(reply: (command: readonly string[]) => Reply): {
  runner: ProcessRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  const runner: ProcessRunner = (command) => {
    calls.push([...command]);
    const { exitCode = 0, stdout = "", stderr = "" } = reply(command);
    return Promise.resolve({ exitCode, stdout, stderr });
  };
  return { runner, calls };
}
