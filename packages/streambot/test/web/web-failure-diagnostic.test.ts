import { expect, test } from "vitest";
import { webErrorCode } from "@shepherdjerred/streambot/observability/web-metrics.ts";
import { MusicError } from "@shepherdjerred/streambot/music/errors.ts";
import { WebError } from "@shepherdjerred/streambot/web/server/errors.ts";
import { classifyWebFailure } from "@shepherdjerred/streambot/web/server/telemetry.ts";
import {
  webFailureDiagnostic,
  webFailureEndpoint,
} from "@shepherdjerred/streambot/web/server/failure-diagnostic.ts";

test("classifies history failures without retaining private queries or dynamic paths", () => {
  expect(
    webFailureEndpoint(
      new Request(
        "http://localhost/api/history?guild=private-guild&query=private-title&credential=private",
      ),
    ),
  ).toBe("/api/history");
  expect(
    webFailureEndpoint(
      new Request(
        "http://localhost/api/history/private-user?credential=private",
      ),
    ),
  ).toBe("other");
});

test("unknown error names and codes remain private, and cyclic causes are bounded", () => {
  const error = Object.assign(new Error("private input"), {
    name: "private user identifier",
    code: "private credential",
  });
  error.cause = error;
  expect(webFailureDiagnostic(error)).toEqual({
    kind: "internal",
    causes: [
      {
        kind: "internal",
        causes: [{ kind: "internal", causes: [{ kind: "depth_limit" }] }],
      },
    ],
  });
  expect(
    webFailureEndpoint(
      new Request("http://localhost/api/private-user?credential=private"),
    ),
  ).toBe("other");
});

test("telemetry classification maps errors to closed codes and outcomes", () => {
  const signal = new AbortController().signal;
  expect(webErrorCode("playback_changed")).toBe("playback_changed");
  expect(webErrorCode("private-user-code")).toBe("other");
  expect(
    classifyWebFailure(new WebError(409, "playback_changed", "x"), signal),
  ).toMatchObject({
    status: 409,
    code: "playback_changed",
    outcome: "conflict",
  });
  expect(
    classifyWebFailure(new WebError(429, "rate_limit", "x"), signal),
  ).toMatchObject({ outcome: "rate_limited" });
  expect(
    // A `WebError` cannot carry an unlisted code; a `MusicError` code is still a plain string.
    classifyWebFailure(new MusicError(418, "private-user-code", "x"), signal),
  ).toMatchObject({ code: "other", outcome: "invalid" });
  expect(classifyWebFailure(new Error("private"), signal)).toMatchObject({
    code: "unavailable",
    outcome: "error",
    kind: "unexpected",
  });
  const gone = new AbortController();
  gone.abort();
  expect(classifyWebFailure(new Error("private"), gone.signal)).toMatchObject({
    code: "client_aborted",
    outcome: "aborted",
    kind: "aborted",
  });
});
