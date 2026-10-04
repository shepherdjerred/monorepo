#!/usr/bin/env bun

export function tasknotesServerRunMarker(runId: string): string {
  if (!/^woodpecker-[1-9]\d*$/u.test(runId)) {
    throw new Error("expected a Woodpecker TaskNotes run identifier");
  }
  return `--tasknotes-server-ci-run=${runId}`;
}

export function completeRunMarkerPattern(marker: string): string {
  return `(^|[[:space:]])${marker}([[:space:]]|$)`;
}

export function commandHasCompleteRunMarker(
  commandLine: string,
  marker: string,
): boolean {
  return commandLine.split(/\s+/u).includes(marker);
}

function tasknotesServerProcessId(line: string): number | undefined {
  const pid = Number(line.trim());
  return Number.isSafeInteger(pid) && pid > 1 ? pid : undefined;
}

function isMarkedBunProcess(pid: number, marker: string): boolean {
  const command = Bun.spawnSync(["ps", "-p", String(pid), "-o", "comm="]);
  if (command.exitCode !== 0) return false;
  if (!command.stdout.toString().trim().endsWith("bun")) return false;

  const arguments_ = Bun.spawnSync([
    "ps",
    "-ww",
    "-p",
    String(pid),
    "-o",
    "args=",
  ]);
  return (
    arguments_.exitCode === 0 &&
    commandHasCompleteRunMarker(arguments_.stdout.toString(), marker)
  );
}

function terminateProcess(pid: number): void {
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    const processAlreadyExited =
      error instanceof Error && "code" in error && error.code === "ESRCH";
    if (!processAlreadyExited) throw error;
  }
}

function main(): void {
  const runId = Bun.argv[2];
  if (runId === undefined) {
    throw new Error("expected a Woodpecker TaskNotes run identifier");
  }
  const marker = tasknotesServerRunMarker(runId);
  const matches = Bun.spawnSync([
    "pgrep",
    "-f",
    "--",
    completeRunMarkerPattern(marker),
  ]);
  if (matches.exitCode !== 0 && matches.exitCode !== 1) {
    throw new Error("could not enumerate TaskNotes test servers");
  }

  for (const line of matches.stdout.toString().split("\n")) {
    const pid = tasknotesServerProcessId(line);
    if (pid === undefined || !isMarkedBunProcess(pid, marker)) continue;
    terminateProcess(pid);
  }
}

if (import.meta.main) main();
