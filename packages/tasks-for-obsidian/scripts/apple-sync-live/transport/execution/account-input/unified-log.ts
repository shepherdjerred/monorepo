import assert from "node:assert/strict";

export type MacLogInterval = {
  startUnixMilliseconds: number;
  endUnixMilliseconds: number;
};

function utcTimestamp(seconds: number): string {
  const iso = new Date(seconds * 1000).toISOString();
  assert.equal(iso.length, 24, "Unified log query requires a four-digit year");
  return iso.slice(0, 19).replace("T", " ") + "+0000";
}

/** log show accepts whole seconds: enclose, never truncate, the original fractional interval. */
export function macUnifiedLogQuery(
  pid: number,
  launchSeconds: number,
  endUnixMilliseconds: number,
) {
  assert.ok(Number.isSafeInteger(pid) && pid > 0 && pid <= 2_147_483_647);
  assert.ok(Number.isFinite(launchSeconds) && launchSeconds > 0);
  const startUnixMilliseconds = launchSeconds * 1000;
  assert.ok(
    Number.isSafeInteger(endUnixMilliseconds) &&
      endUnixMilliseconds >= startUnixMilliseconds,
  );
  return {
    interval: { startUnixMilliseconds, endUnixMilliseconds },
    argv: [
      "/usr/bin/log",
      "show",
      "--info",
      "--debug",
      "--style",
      "ndjson",
      "--start",
      utcTimestamp(Math.floor(launchSeconds)),
      "--end",
      utcTimestamp(Math.ceil(endUnixMilliseconds / 1000)),
      "--predicate",
      "processIdentifier == " + String(pid),
    ],
  };
}
