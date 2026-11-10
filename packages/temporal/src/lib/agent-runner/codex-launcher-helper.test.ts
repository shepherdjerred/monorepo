import { afterEach, describe, expect, test, vi } from "vitest";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod/v4";
import { providerPathOverride } from "./codex-launcher.ts";
import { cleanupCodexRun } from "./codex-cleanup.ts";

const mocks = vi.hoisted(() => ({ materialize: vi.fn() }));
vi.mock("./codex-bubblewrap.ts", () => ({
  materializeCodexBubblewrap: mocks.materialize,
}));
const platform = Object.getOwnPropertyDescriptor(process, "platform");
const getuid = Object.getOwnPropertyDescriptor(process, "getuid");
const owned: string[] = [];
function linuxRoot() {
  Object.defineProperty(process, "platform", {
    value: "linux",
    configurable: true,
  });
  Object.defineProperty(process, "getuid", {
    value: () => 0,
    configurable: true,
  });
  vi.stubEnv("AGENT_PROVIDER_UID", "1001");
}
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  if (platform !== undefined)
    Object.defineProperty(process, "platform", platform);
  if (getuid !== undefined) Object.defineProperty(process, "getuid", getuid);
  await Promise.all(
    owned
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("explicit helper selection", () => {
  test.each([
    "override",
    "no-uid",
    "non-linux",
    "non-root",
    "no-path",
    "empty-path",
  ])("requested selection refuses %s without fallback", async (failure) => {
    linuxRoot();
    if (failure === "no-uid") vi.stubEnv("AGENT_PROVIDER_UID", undefined);
    if (failure === "non-linux")
      Object.defineProperty(process, "platform", {
        value: "darwin",
        configurable: true,
      });
    if (failure === "non-root")
      Object.defineProperty(process, "getuid", {
        value: () => 1001,
        configurable: true,
      });
    const input = {
      linuxSandboxHelper: "bundled-codex",
      env:
        failure === "no-path"
          ? {}
          : { PATH: failure === "empty-path" ? "" : "/usr/bin:/bin" },
      ...(failure === "override"
        ? { codexPathOverride: "/unrelated/codex" }
        : {}),
    };
    await expect(
      Reflect.apply(providerPathOverride, undefined, [input]),
    ).rejects.toThrow();
    expect(mocks.materialize).not.toHaveBeenCalled();
  });

  test("unknown runtime selection is rejected", async () => {
    await expect(
      Reflect.apply(providerPathOverride, undefined, [
        { linuxSandboxHelper: "unknown" },
      ]),
    ).rejects.toThrow();
    expect(mocks.materialize).not.toHaveBeenCalled();
  });

  test("ordinary callers retain the no-UID executable selection", async () => {
    vi.stubEnv("AGENT_PROVIDER_UID", undefined);
    expect(await providerPathOverride({})).toEqual({
      pathOverride: undefined,
      wrapperDirectory: undefined,
    });
    expect(
      await providerPathOverride({ codexPathOverride: "/custom/codex" }),
    ).toEqual({
      pathOverride: { codexPathOverride: "/custom/codex" },
      wrapperDirectory: undefined,
    });
    expect(mocks.materialize).not.toHaveBeenCalled();
  });
});

describe("existing wrapper lifecycle and exact PATH preservation", () => {
  test.each([false, true])(
    "preserves every original PATH entry with helper selection=%s",
    async (selected) => {
      linuxRoot();
      const directory = await mkdtemp(
        path.join(os.tmpdir(), "codex-helper-path-"),
      );
      owned.push(directory);
      const bin = path.join(directory, "bin");
      await mkdir(bin);
      await writeFile(
        path.join(bin, "setpriv"),
        '#!/bin/sh\nprintf "%s" "$PATH"\n',
        { mode: 0o755 },
      );
      const originalPath = `${bin}:/usr/bin:/bin:/extra-tools:/sentinel'entry::relative-entry`;
      mocks.materialize.mockImplementation(async (input: unknown) => {
        const { wrapperDirectory } = z
          .object({ wrapperDirectory: z.string() })
          .parse(input);
        await symlink(
          "/synthetic-pinned-helper",
          path.join(wrapperDirectory, "bwrap"),
        );
      });
      const launcher = await providerPathOverride({
        env: { PATH: originalPath },
        ...(selected ? { linuxSandboxHelper: "bundled-codex" } : {}),
      });
      if (
        launcher.wrapperDirectory === undefined ||
        launcher.pathOverride?.codexPathOverride === undefined
      )
        throw new Error("missing wrapper");
      owned.push(launcher.wrapperDirectory);
      const child = Bun.spawn(
        [launcher.pathOverride.codexPathOverride, "app-server"],
        {
          env: { PATH: originalPath, HOME: directory },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(code).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toBe(
        selected
          ? `${launcher.wrapperDirectory}:${originalPath}`
          : originalPath,
      );
      expect(mocks.materialize).toHaveBeenCalledTimes(selected ? 1 : 0);
      if (selected)
        expect(
          await readFile(launcher.pathOverride.codexPathOverride, "utf8"),
        ).toContain("'--reuid=1001' '--regid=1001' '--clear-groups' '--'");
      vi.stubEnv("AGENT_PROVIDER_UID", undefined);
      expect(
        await cleanupCodexRun({
          workdir: directory,
          subscriptionAuthPath: undefined,
          providerWrapperDirectory: launcher.wrapperDirectory,
          parser: { finish: vi.fn() },
          trace: { end: vi.fn() },
          traceOutcome: "success",
        }),
      ).toBeUndefined();
      await expect(lstat(launcher.wrapperDirectory)).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );

  test("helper setup failure removes its partial alias and entire owned wrapper", async () => {
    linuxRoot();
    let wrapper = "";
    mocks.materialize.mockImplementation(async (input: unknown) => {
      wrapper = z
        .object({ wrapperDirectory: z.string() })
        .parse(input).wrapperDirectory;
      await chmod(wrapper, 0o755);
      await symlink("/synthetic-pinned-helper", path.join(wrapper, "bwrap"));
      throw new Error("synthetic verification failure");
    });
    await expect(
      providerPathOverride({
        linuxSandboxHelper: "bundled-codex",
        env: { PATH: "/usr/bin:/bin" },
      }),
    ).rejects.toThrow("synthetic verification failure");
    expect(wrapper).not.toBe("");
    await expect(lstat(wrapper)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
