import { describe, expect, test } from "vitest";
import {
  dirtyTreeError,
  dockerRunArguments,
  finishLinuxRun,
  e2eAffectedEnvironment,
  packagesWithPlatformSnapshots,
  parseE2eAffectedArgs,
  pinnedPlaywrightImage,
  platformSnapshotWarning,
} from "./e2e-affected.ts";

const denied = () =>
  Promise.reject(new Error("EACCES: permission denied, rmdir '/clone/x'"));

describe("e2e:affected", () => {
  test("defaults to the merge base with origin/main", () => {
    expect(parseE2eAffectedArgs([])).toEqual({
      base: undefined,
      all: false,
      linux: false,
    });
    expect(parseE2eAffectedArgs(["--"])).toEqual({
      base: undefined,
      all: false,
      linux: false,
    });
  });

  test("accepts an explicit base, every project or the Linux image, never base and all", () => {
    expect(parseE2eAffectedArgs(["--", "--base", "origin/release"])).toEqual({
      base: "origin/release",
      all: false,
      linux: false,
    });
    expect(parseE2eAffectedArgs(["--all"])).toMatchObject({ all: true });
    expect(parseE2eAffectedArgs(["--linux", "--all"])).toMatchObject({
      all: true,
      linux: true,
    });
    expect(() => parseE2eAffectedArgs(["--all", "--base", "main"])).toThrow(
      "mutually exclusive",
    );
    expect(() => parseE2eAffectedArgs(["--base"])).toThrow("git ref");
    expect(() => parseE2eAffectedArgs(["--base", "--all"])).toThrow("git ref");
    expect(() => parseE2eAffectedArgs(["--bogus"])).toThrow("unknown argument");
  });

  test("runs the lane under CI's reporter settings with a local install", () => {
    const base = "a".repeat(40);
    const environment = e2eAffectedEnvironment(
      {
        PATH: "/usr/bin",
        CI_PIPELINE_EVENT: "push",
        BUN_CACHE_LOCK_FILE: "/woodpecker/lock",
      },
      base,
    );
    expect(environment).toMatchObject({
      PATH: "/usr/bin",
      CI: "true",
      CI_CHANGED_BASE: base,
      BUN_INSTALL_LOCK_MODE: "local",
    });
    expect(environment["CI_PIPELINE_EVENT"]).toBeUndefined();
    expect(environment["BUN_CACHE_LOCK_FILE"]).toBeUndefined();
  });

  test("an empty base asks the runner for every project", () => {
    expect(e2eAffectedEnvironment({}, "")["CI_CHANGED_BASE"]).toBe("");
  });
});

describe("uncommitted changes", () => {
  test("a clean tree is accepted", () => {
    expect(dirtyTreeError("")).toBeUndefined();
    expect(dirtyTreeError("\n")).toBeUndefined();
  });

  test("modified and untracked files are refused with a commit-first message", () => {
    const message = dirtyTreeError(
      " M packages/sjer.red/src/a.ts\n?? new.ts\n",
    );
    expect(message).toContain("commit first");
    expect(message).toContain("packages/sjer.red/src/a.ts");
    expect(message).toContain("new.ts");
  });
});

describe("per-platform snapshots", () => {
  const workspaces = new Map([
    ["sjer.red", "packages/sjer.red/"],
    ["@shepherdjerred/tracker", "packages/tracker/"],
  ]);
  const tracked = [
    "packages/sjer.red/test/index.spec.ts-snapshots/home-chromium-darwin.png",
    "packages/sjer.red/test/index.spec.ts-snapshots/home-chromium-linux.png",
    "packages/tracker/e2e/logo.png",
  ];

  test("finds the selected packages that own darwin or linux baselines", () => {
    expect(
      packagesWithPlatformSnapshots(
        ["sjer.red", "@shepherdjerred/tracker"],
        tracked,
        workspaces,
      ),
    ).toEqual(["sjer.red"]);
    expect(
      packagesWithPlatformSnapshots(
        ["@shepherdjerred/tracker"],
        tracked,
        workspaces,
      ),
    ).toEqual([]);
  });

  test("warns off Linux, naming --linux, and stays quiet on Linux or without snapshots", () => {
    expect(platformSnapshotWarning(["sjer.red"], "darwin")).toContain(
      "--linux",
    );
    expect(platformSnapshotWarning(["sjer.red"], "darwin")).toContain(
      "sjer.red",
    );
    expect(platformSnapshotWarning(["sjer.red"], "linux")).toBeUndefined();
    expect(platformSnapshotWarning([], "darwin")).toBeUndefined();
  });
});

describe("--linux", () => {
  const digest = `sha256:${"a".repeat(64)}`;

  test("pins the image by the digest file CI reads", () => {
    expect(pinnedPlaywrightImage(`${digest}\n`)).toBe(
      `docker.io/shepherdjerred/ci-playwright@${digest}`,
    );
    expect(() => pinnedPlaywrightImage("latest")).toThrow("sha256 digest");
  });

  test("mounts a clean clone and runs the CI lane's runner under its settings", () => {
    const image = pinnedPlaywrightImage(digest);
    const args = dockerRunArguments({
      image,
      cloneDir: "/clone",
      changedBase: "b".repeat(40),
      hostUser: { uid: 1000, gid: 1001 },
    });
    expect(args.slice(0, 2)).toEqual(["run", "--rm"]);
    expect(args).toContain("/clone:/workspace");
    expect(args.join(" ")).toContain("--platform linux/amd64");
    expect(args).toContain("CI=true");
    expect(args).toContain(`CI_CHANGED_BASE=${"b".repeat(40)}`);
    expect(args).toContain(`CI_PLAYWRIGHT_IMAGE=${image}`);
    expect(args.at(-1)).toContain("MISE_TOOLCHAIN_SCOPE=postgres");
    expect(args.at(-1)).toContain("ci/scripts/selection/run-playwright.ts");
    expect(args[args.indexOf(image) - 1]).not.toBe("--volume");
  });

  test("hands the clone back to the host user on every exit", () => {
    const args = dockerRunArguments({
      image: pinnedPlaywrightImage(digest),
      cloneDir: "/clone",
      changedBase: "",
      hostUser: { uid: 1000, gid: 1001 },
    });
    expect(args.at(-1)).toMatch(
      /^trap 'chown -R 1000:1001 \/workspace' EXIT; /u,
    );
    for (const hostUser of [
      { uid: -1, gid: 0 },
      { uid: 0, gid: 1.5 },
    ])
      expect(() =>
        dockerRunArguments({
          image: "i",
          cloneDir: "/clone",
          changedBase: "",
          hostUser,
        }),
      ).toThrow("non-negative integers");
  });

  describe("exit code", () => {
    test("passing tests stay a success when the clone cannot be removed, with a warning naming the path", async () => {
      const result = await finishLinuxRun(0, "/clone", denied);
      expect(result.status).toBe(0);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]).toContain("/clone");
      expect(result.messages[0]).toContain("EACCES");
      expect(result.messages[0]).toMatch(/^warning:/u);
    });

    test("a clean removal is silent", async () => {
      const removed: string[] = [];
      const result = await finishLinuxRun(0, "/clone", (directory) => {
        removed.push(directory);
        return Promise.resolve();
      });
      expect(result).toEqual({ status: 0, messages: [] });
      expect(removed).toEqual(["/clone"]);
    });

    test("a failed run keeps the clone, reports where, and keeps the container's status", async () => {
      let attempts = 0;
      const result = await finishLinuxRun(3, "/clone", () => {
        attempts++;
        return Promise.resolve();
      });
      expect(result.status).toBe(3);
      expect(result.messages[0]).toContain("/clone");
      expect(attempts).toBe(0);
    });
  });
});
