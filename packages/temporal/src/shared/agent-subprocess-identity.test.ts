import { describe, expect, test } from "bun:test";
import {
  providerSubprocessCommand,
  providerSubprocessUid,
} from "./agent-subprocess-identity.ts";

describe("provider subprocess identity", () => {
  test("uses the caller identity when isolation is not configured locally", () => {
    expect(providerSubprocessUid({})).toBeUndefined();
  });

  test("parses the dedicated production uid", () => {
    expect(providerSubprocessUid({ AGENT_PROVIDER_UID: "1001" })).toBe(1001);
    expect(
      providerSubprocessCommand(["claude", "-p", "prompt"], {
        AGENT_PROVIDER_UID: "1001",
      }),
    ).toEqual(["setpriv", "--reuid=1001", "--", "claude", "-p", "prompt"]);
  });

  test("leaves local commands unwrapped", () => {
    expect(providerSubprocessCommand(["codex", "exec"], {})).toEqual([
      "codex",
      "exec",
    ]);
  });

  test.each(["", "0", "-1", "provider", "1.5"])(
    "rejects invalid uid %s",
    (uid) => {
      expect(() =>
        providerSubprocessUid({ AGENT_PROVIDER_UID: uid }),
      ).toThrow();
    },
  );
});
