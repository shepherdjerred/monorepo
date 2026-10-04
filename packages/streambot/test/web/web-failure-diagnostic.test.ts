import { expect, test } from "vitest";
import {
  webFailureDiagnostic,
  webFailureEndpoint,
} from "@shepherdjerred/streambot/web/server/failure-diagnostic.ts";

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
