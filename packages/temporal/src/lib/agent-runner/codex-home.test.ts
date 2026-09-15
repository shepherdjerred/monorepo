import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import {
  createCodexProviderHome,
  prepareCodexSubscriptionHome,
} from "./codex-home.ts";

test("creates a traversable lifecycle parent and provider-owned Codex home", async () => {
  const uid = process.getuid?.();
  if (uid === undefined)
    throw new Error("Provider home test requires a Unix uid");
  const home = await createCodexProviderHome(uid);
  try {
    const [directoryStat, homeStat, codexStat] = await Promise.all([
      stat(home.directory),
      stat(home.environment.HOME),
      stat(home.environment.CODEX_HOME),
    ]);
    expect(directoryStat.mode & 0o777).toBe(0o755);
    expect(homeStat.uid).toBe(uid);
    expect(codexStat.uid).toBe(uid);
    expect(codexStat.mode & 0o777).toBe(0o700);
  } finally {
    await rm(home.directory, { recursive: true, force: true });
  }
});

test("subscription home and restored session directories are writable without an auth file", async () => {
  const uid = process.getuid?.();
  if (uid === undefined)
    throw new Error("Provider home test requires a Unix uid");
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "codex-subscription-home-test-"),
  );
  try {
    const home = path.join(directory, "codex-home");
    await mkdir(path.join(home, "sessions"), { recursive: true });
    await prepareCodexSubscriptionHome(home, uid);
    const [homeStat, sessionStat] = await Promise.all([
      stat(home),
      stat(path.join(home, "sessions")),
    ]);
    expect(homeStat.uid).toBe(uid);
    expect(sessionStat.uid).toBe(uid);
    const session = path.join(home, "sessions", "new-session.jsonl");
    await Bun.write(session, "test session");
    expect(await Bun.file(session).text()).toBe("test session");
    expect(await Bun.file(path.join(home, "auth.json")).exists()).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
