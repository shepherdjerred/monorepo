import {
  execFileSync,
  type ExecFileSyncOptionsWithStringEncoding,
} from "node:child_process";

export const PS_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

export function parseOwnedLockHelpers(
  output: string,
  parentPid = process.pid,
): number[] {
  return output.split("\n").flatMap((row) => {
    const ids = /^(\d+)\s+(\d+)\s/u.exec(row.trim());
    return ids?.[1] !== undefined &&
      Number(ids[2]) === parentPid &&
      row.includes("lock-helper.py")
      ? [Number(ids[1])]
      : [];
  });
}

export function ownedLockHelpers(
  runPs: (
    file: string,
    args: readonly string[],
    options: ExecFileSyncOptionsWithStringEncoding,
  ) => string = execFileSync,
  parentPid = process.pid,
): number[] {
  return parseOwnedLockHelpers(
    runPs("ps", ["-axo", "pid=,ppid=,args="], {
      encoding: "utf8",
      maxBuffer: PS_MAX_BUFFER_BYTES,
    }),
    parentPid,
  );
}
