import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  claudeIdentityExports,
  cursorIdentityInput,
  identityHook,
} from "#lib/tracker/hooks.ts";
import { claudeModel } from "#lib/tracker/model.ts";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
test("Claude SessionStart appends its native identity while preserving existing environment exports", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tracker-hook-"));
  directories.push(directory);
  const file = path.join(directory, "env");
  await Bun.write(file, "export EXISTING=value\n");
  await identityHook(
    "claude-code",
    { session_id: "native-session", transcript_path: "/a'b/session.jsonl" },
    { CLAUDE_ENV_FILE: file },
  );
  expect(await Bun.file(file).text()).toBe(
    "export EXISTING=value\nexport TRACKER_ACTOR_HARNESS='claude-code'\nexport CLAUDE_CODE_SESSION_ID='native-session'\nexport CLAUDE_TRANSCRIPT_PATH='/a'\\''b/session.jsonl'\n",
  );
  expect(() => claudeIdentityExports({ session_id: "$(secret)" })).toThrow();
  await expect(
    identityHook("claude-code", { session_id: "session" }, {}),
  ).rejects.toThrow("CLAUDE_ENV_FILE");
});
test("Cursor preserves the shell input and adds identity with quoted values", () => {
  const command = "printf '%s' \"$HOME\"";
  expect(
    cursorIdentityInput({
      conversation_id: "cursor-session",
      tool_name: "Shell",
      tool_input: { command, working_directory: "/repo" },
      model: "model'$(not-executed)",
    }),
  ).toEqual({
    updated_input: {
      working_directory: "/repo",
      command: `export TRACKER_ACTOR_HARNESS='cursor'\nexport CURSOR_CONVERSATION_ID='cursor-session'\nexport TRACKER_ACTOR_MODEL='model'\\''$(not-executed)'\n${command}`,
    },
  });
  expect(() =>
    cursorIdentityInput({
      conversation_id: "",
      tool_name: "Shell",
      tool_input: { command },
    }),
  ).toThrow();
});
test("model detection reads only matching assistant records in the exact native transcript", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tracker-model-"));
  directories.push(directory);
  const file = path.join(directory, "session.jsonl");
  await Bun.write(
    file,
    [
      JSON.stringify({
        type: "assistant",
        sessionId: "ours",
        message: { model: "older" },
      }),
      JSON.stringify({
        type: "assistant",
        sessionId: "ours",
        message: { model: "current" },
      }),
      JSON.stringify({
        type: "assistant",
        sessionId: "another",
        message: { model: "unrelated" },
      }),
      "{partial",
    ].join("\n"),
  );
  await expect(
    claudeModel({
      CLAUDE_TRANSCRIPT_PATH: file,
      CLAUDE_CODE_SESSION_ID: "ours",
    }),
  ).resolves.toBe("current");
  await expect(
    claudeModel({
      CLAUDE_TRANSCRIPT_PATH: file,
      CLAUDE_CODE_SESSION_ID: "absent",
    }),
  ).resolves.toBeUndefined();
  await expect(claudeModel({})).resolves.toBeUndefined();
});
