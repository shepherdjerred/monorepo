import { afterEach, describe, expect, test } from "vitest";
import { mkdtemp, realpath, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { resolveForumIdentity } from "#lib/forum/identity.ts";
import {
  sessionForumCredentials,
  type ForumProcess,
} from "#lib/forum/sessions.ts";
import { parseForumArguments } from "#handlers/forum.ts";
import {
  EMPTY_FORUM_CONTEXT,
  captureForumContext,
} from "#lib/forum/context.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true })),
  );
});

async function fixture(session = "session-a") {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forum-sessions-"));
  directories.push(directory);
  await Bun.write(
    path.join(directory, "state.json"),
    JSON.stringify({ itemId: "trial", vaultId: "vault", version: "2.3.13" }),
  );
  const calls: { args: string[]; input: string | undefined }[] = [];
  const identity = resolveForumIdentity("codex", session, {});
  let accountName = identity.username;
  const key = "k".repeat(30) + "-_";
  let itemExists = false;
  let failCreate = false;
  const item = {
    id: "sessionitem",
    vault: { id: "vault" },
    fields: [
      { id: "username", value: identity.legacyUsername },
      { id: "password", value: key },
    ],
  };
  const run: ForumProcess = async (args, input) => {
    calls.push({ args, input });
    if (args[0] === "docker") {
      if (args[1] === "context")
        return JSON.stringify([
          { Endpoints: { docker: { Host: "unix:///local/docker.sock" } } },
        ]);
      if (args[1] === "inspect")
        return JSON.stringify({
          project: "toolkit-forum",
          service: "web",
          running: true,
          mounts: [
            {
              Source: path.join(directory, "source"),
              Destination: "/var/www/html",
              RW: false,
            },
          ],
        });
      return JSON.stringify({
        username: accountName,
        user_id: 8,
        api_key: key,
        digest: identity.digest,
      });
    }
    if (args[1] === "read") return key;
    if (args[2] === "list")
      return JSON.stringify(
        itemExists
          ? [
              {
                id: item.id,
                title: `Agent Forum Session ${identity.legacyUsername}`,
              },
            ]
          : [],
      );
    if (args[2] === "create") {
      if (failCreate) throw new Error("Forum op operation failed");
      itemExists = true;
      return JSON.stringify(item);
    }
    if (args[2] === "get") return JSON.stringify(item);
    throw new Error("Unexpected test process");
  };
  return {
    calls,
    key,
    item,
    setAccountName: (value: string) => {
      accountName = value;
    },
    setFailCreate: (value: boolean) => {
      failCreate = value;
    },
    options: {
      identity,
      directory,
      baseUrl: "http://127.0.0.1:8765",
      profileReference: "op://vault/trial/codex_key",
      run,
    },
  };
}

describe("forum session identity", () => {
  test("resumes native Codex threads and honors an explicit override", () => {
    const environment = { CODEX_THREAD_ID: "native" };
    expect(resolveForumIdentity("codex", undefined, environment)).toEqual(
      resolveForumIdentity("codex", "native", {}),
    );
    expect(
      resolveForumIdentity("codex", "override", environment).sessionId,
    ).toBe("override");
    expect(() =>
      resolveForumIdentity("claude", undefined, environment),
    ).toThrow("--session");
    expect(() => resolveForumIdentity("codex", undefined, {})).toThrow(
      "--session",
    );
  });
  test("different sessions and runners cannot share an account", () => {
    const first = resolveForumIdentity("codex", "one", {});
    expect(first.username).not.toBe(
      resolveForumIdentity("codex", "two", {}).username,
    );
    expect(first.digest).not.toBe(
      resolveForumIdentity("claude", "one", {}).digest,
    );
    expect(() => resolveForumIdentity("unknown", "one", {})).toThrow("Unknown");
    for (const id of ["", "two sessions", "a".repeat(257)])
      expect(() => resolveForumIdentity("codex", id, {})).toThrow("Session ID");
  });
  test("CLI accepts an identity command and explicit session", () => {
    expect(
      parseForumArguments("identity", [
        "--agent",
        "claude",
        "--session",
        "abc",
        "--model",
        "test-model",
        "--json",
      ]),
    ).toMatchObject({
      subcommand: "identity",
      session: "abc",
      model: "test-model",
      json: true,
    });
  });
  test("creates once, resumes using only 1Password, and caches no key", async () => {
    const fixtureData = await fixture();
    const first = await sessionForumCredentials(fixtureData.options);
    expect(first.identity).toMatchObject({ userId: 8, sessionId: "session-a" });
    const callCount = fixtureData.calls.length;
    expect(await sessionForumCredentials(fixtureData.options)).toEqual(first);
    expect(fixtureData.calls.slice(callCount)).toEqual([
      {
        args: ["op", "read", "op://vault/sessionitem/password"],
        input: undefined,
      },
    ]);
    const filename = path.join(
      fixtureData.options.directory,
      "sessions.sqlite",
    );
    const metadata = await stat(filename);
    const contents = await Bun.file(filename).text();
    expect(metadata.mode & 0o777).toBe(0o600);
    expect(contents.includes(fixtureData.key)).toBe(false);
    expect(
      JSON.stringify(fixtureData.calls.map((call) => call.args)),
    ).not.toContain(fixtureData.key);
  });
  test("concurrent first uses provision one account and item", async () => {
    const fixtureData = await fixture();
    const results = await Promise.all([
      sessionForumCredentials(fixtureData.options),
      sessionForumCredentials(fixtureData.options),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(
      fixtureData.calls.filter((call) => call.args[2] === "create"),
    ).toHaveLength(1);
  });
  test("failed credential creation releases the transaction for recovery", async () => {
    const fixtureData = await fixture();
    fixtureData.setFailCreate(true);
    await expect(sessionForumCredentials(fixtureData.options)).rejects.toThrow(
      "operation failed",
    );
    fixtureData.setFailCreate(false);
    const recovered = await sessionForumCredentials(fixtureData.options);
    expect(recovered.identity.userId).toBe(8);
  });
  test("rebuilds the cache from an existing 1Password item", async () => {
    const fixtureData = await fixture();
    await sessionForumCredentials(fixtureData.options);
    const db = new Database(
      path.join(fixtureData.options.directory, "sessions.sqlite"),
    );
    db.run("DELETE FROM sessions");
    db.close();
    const before = fixtureData.calls.length;
    await sessionForumCredentials(fixtureData.options);
    expect(
      fixtureData.calls.slice(before).some((call) => call.args[2] === "get"),
    ).toBe(true);
    expect(
      fixtureData.calls.filter((call) => call.args[2] === "create"),
    ).toHaveLength(1);
  });
  test("rejects mismatched targets before provisioning", async () => {
    const fixtureData = await fixture();
    await expect(
      sessionForumCredentials({
        ...fixtureData.options,
        baseUrl: "http://example.com",
      }),
    ).rejects.toThrow("MacBook");
    await expect(
      sessionForumCredentials({
        ...fixtureData.options,
        profileReference: "op://other/item/password",
      }),
    ).rejects.toThrow("local trial");
    expect(fixtureData.calls).toHaveLength(0);
  });
  test("does not expose malformed provisioning output containing secrets", async () => {
    const fixtureData = await fixture();
    await expect(
      sessionForumCredentials({
        ...fixtureData.options,
        run: async () => fixtureData.key,
      }),
    ).rejects.toThrow("Invalid response");
  });
});

describe("forum session profiles", () => {
  test("updates profile context without changing the account or key, and remembers model", async () => {
    const data = await fixture();
    const original = await sessionForumCredentials({
      ...data.options,
      context: { ...EMPTY_FORUM_CONTEXT, model: "test-model", branch: "first" },
    });
    const updated = await sessionForumCredentials({
      ...data.options,
      context: { ...EMPTY_FORUM_CONTEXT, branch: "second" },
    });
    expect(updated.identity.userId).toBe(original.identity.userId);
    expect(updated.apiKey).toBe(original.apiKey);
    expect(updated.identity.context).toMatchObject({
      model: "test-model",
      branch: "second",
    });
    expect(data.calls.filter((call) => call.args[2] === "create")).toHaveLength(
      1,
    );
    const request = data.calls.findLast(
      (call) => call.args[1] === "exec",
    )?.input;
    expect(JSON.parse(request ?? "{}")).toMatchObject({
      context: { model: "test-model", branch: "second" },
    });
  });
  test("migrates the original cache while retaining user IDs and key references", async () => {
    const data = await fixture();
    const original = await sessionForumCredentials(data.options);
    const db = new Database(
      path.join(data.options.directory, "sessions.sqlite"),
    );
    db.run("DROP TABLE sessions");
    db.run(
      "CREATE TABLE sessions (digest TEXT PRIMARY KEY, username TEXT NOT NULL, user_id INTEGER NOT NULL, reference TEXT NOT NULL)",
    );
    db.query("INSERT INTO sessions VALUES (?, ?, ?, ?)").run(
      data.options.identity.digest,
      data.options.identity.legacyUsername,
      original.identity.userId,
      "op://vault/sessionitem/password",
    );
    db.close();
    const migrated = await sessionForumCredentials(data.options);
    expect(migrated.identity.username).toBe(data.options.identity.username);
    expect(migrated.identity.userId).toBe(original.identity.userId);
    expect(migrated.apiKey).toBe(original.apiKey);
    expect(data.calls.filter((call) => call.args[2] === "create")).toHaveLength(
      1,
    );
  });
  test("a generated name collision keeps its chosen suffix when resumed", async () => {
    const data = await fixture();
    data.setAccountName(`${data.options.identity.username} 2`);
    const first = await sessionForumCredentials(data.options);
    const resumed = await sessionForumCredentials(data.options);
    expect(first.identity.username).toBe(`${data.options.identity.username} 2`);
    expect(resumed.identity.username).toBe(first.identity.username);
    expect(resumed.identity.userId).toBe(first.identity.userId);
  });
  test("captures Git context even before the first commit and handles directories outside Git", async () => {
    const data = await fixture();
    const outside = await captureForumContext(
      undefined,
      data.options.directory,
    );
    expect(outside).toMatchObject({
      branch: null,
      worktree: null,
      cwd: data.options.directory,
    });
    const git = Bun.spawn(
      [
        "git",
        "init",
        "--quiet",
        "--initial-branch=profile-context",
        data.options.directory,
      ],
      { stdout: "ignore", stderr: "ignore" },
    );
    expect(await git.exited).toBe(0);
    const context = await captureForumContext(
      "test-model",
      data.options.directory,
    );
    const canonicalDirectory = await realpath(data.options.directory);
    expect(context).toMatchObject({
      model: "test-model",
      branch: "profile-context",
      worktree: canonicalDirectory,
      repository: canonicalDirectory,
    });
  });
});
