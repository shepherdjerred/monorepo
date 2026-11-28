import { expect, test } from "vitest";
import {
  PS_MAX_BUFFER_BYTES,
  ownedLockHelpers,
  parseOwnedLockHelpers,
} from "./lock-helper-processes.ts";

test("ownedLockHelpers passes a 64 MiB maxBuffer and parses >1 MiB ps output", () => {
  const noisyArgs = "x".repeat(4096);
  const noisyRows = Array.from(
    { length: 300 },
    (_, index) =>
      `${String(10_000 + index)} 1 /Applications/Chromium --flag=${noisyArgs}`,
  );
  const largePsOutput = [
    "  4101  9999 python3 /repo/src/filesystem/lock-helper.py --hold",
    ...noisyRows,
    "  4102  9998 python3 /repo/src/filesystem/lock-helper.py --other-parent",
    "  4103  9999 /usr/bin/sleep 10",
    "  4104  9999 /usr/bin/python3 lock-helper.py --batch",
    "",
  ].join("\n");
  expect(Buffer.byteLength(largePsOutput, "utf8")).toBeGreaterThan(1024 * 1024);

  expect(parseOwnedLockHelpers(largePsOutput, 9999)).toEqual([4101, 4104]);

  let recordedCall:
    | {
        file: string;
        args: readonly string[];
        encoding: BufferEncoding;
        maxBuffer: number | undefined;
      }
    | undefined;
  const pids = ownedLockHelpers((file, args, options) => {
    recordedCall = {
      file,
      args,
      encoding: options.encoding,
      maxBuffer: options.maxBuffer,
    };
    return largePsOutput;
  }, 9999);

  expect(recordedCall).toEqual({
    file: "ps",
    args: ["-axo", "pid=,ppid=,args="],
    encoding: "utf8",
    maxBuffer: PS_MAX_BUFFER_BYTES,
  });
  expect(PS_MAX_BUFFER_BYTES).toBe(64 * 1024 * 1024);
  expect(pids).toEqual([4101, 4104]);
  expect(ownedLockHelpers()).toEqual([]);
});
