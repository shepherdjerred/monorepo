import { execFileSync } from "node:child_process";

export function ownedLockHelpers() {
  return execFileSync("ps", ["-axo", "pid=,ppid=,args="], { encoding: "utf8" })
    .split("\n")
    .flatMap((row) => {
      const ids = /^(\d+)\s+(\d+)\s/u.exec(row.trim());
      return ids?.[1] !== undefined &&
        Number(ids[2]) === process.pid &&
        row.includes("lock-helper.py")
        ? [Number(ids[1])]
        : [];
    });
}
