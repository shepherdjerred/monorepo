import { afterEach, describe, expect, test } from "vitest";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  credentialHelperScript,
  dockerCredentialConfigJson,
  execReleaseCommand,
  formatReleaseSummary,
  INDEX_ASTRO_PATH,
  openKubectlPortForward,
  parseForwardedPort,
  parseReleaseArgs,
  releaseWindowsCrossCompiler,
  resolveHeadCommit,
  rewriteIndexAstro,
  rewriteWindowsAstro,
  SELFTEST_REPORT_DIR,
  waitForPortForwardPort,
  WINDOWS_ASTRO_PATH,
  WINDOWS_IMAGES,
} from "./windows-cross-compiler.ts";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "..", "..");
const BASE_DIGEST = `sha256:${"a".repeat(64)}`;
const WINUI_DIGEST = `sha256:${"b".repeat(64)}`;
const SOURCE_COMMIT = "c".repeat(40);
const SOURCE_FINGERPRINT = `sha256:${"d".repeat(64)}`;

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function createReleaseFixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "win-cross-fixture-"));
  tempDirs.push(root);
  const filesToCopy = [
    "packages/windows-cross-compiler/images/windows-cross-compiler/DIGEST",
    "packages/windows-cross-compiler/images/windows-cross-compiler/STATE.json",
    "packages/windows-cross-compiler/images/windows-cross-compiler-winui/DIGEST",
    "packages/windows-cross-compiler/images/windows-cross-compiler-winui/STATE.json",
    WINDOWS_ASTRO_PATH,
    INDEX_ASTRO_PATH,
  ];
  for (const rel of filesToCopy) {
    await cp(path.join(REPOSITORY_ROOT, rel), path.join(root, rel), {
      recursive: true,
    });
  }
  return root;
}

describe("parseReleaseArgs", () => {
  test("parses --release-number and optional --commit in both flag forms", () => {
    expect(parseReleaseArgs(["--release-number", "19500"])).toEqual({
      releaseNumber: 19_500,
    });
    expect(
      parseReleaseArgs(["--release-number=19501", "--commit", SOURCE_COMMIT]),
    ).toEqual({
      releaseNumber: 19_501,
      commit: SOURCE_COMMIT,
    });
    expect(
      parseReleaseArgs([
        "--release-number",
        "19502",
        `--commit=${SOURCE_COMMIT}`,
      ]),
    ).toEqual({
      releaseNumber: 19_502,
      commit: SOURCE_COMMIT,
    });
  });

  test("rejects missing, non-numeric, or unknown arguments", () => {
    expect(() => parseReleaseArgs([])).toThrow(/--release-number requires/u);
    expect(() => parseReleaseArgs(["--release-number", "0"])).toThrow(
      /--release-number requires/u,
    );
    expect(() =>
      parseReleaseArgs(["--release-number", "19500", "--commit", "not-a-sha"]),
    ).toThrow(/40-character lowercase hex SHA/u);
    expect(() =>
      parseReleaseArgs(["--release-number", "19500", "--bogus"]),
    ).toThrow(/Unknown option/iu);
  });
});

describe("credential helper & port-forward helpers", () => {
  test("writes credHelpers config with zero secret material on disk", () => {
    const ConfigSchema = z.object({
      credHelpers: z.record(z.string(), z.string()),
      auths: z.unknown().optional(),
    });
    const config = ConfigSchema.parse(JSON.parse(dockerCredentialConfigJson()));
    expect(config.auths).toBeUndefined();
    expect(config.credHelpers).toEqual({
      "docker.io": "windows-cross-publisher",
      "index.docker.io": "windows-cross-publisher",
      "registry-1.docker.io": "windows-cross-publisher",
    });

    const script = credentialHelperScript(
      "/repo/scripts/onepassword/with-service-account.sh",
    );
    expect(script).toContain("with-service-account.sh");
    expect(script).toContain("op run --no-masking");
    expect(script).toContain("DOCKERHUB_USERNAME");
    expect(script).toContain("DOCKERHUB_PUBLISH_TOKEN");
  });

  test("parses forwarded port and waits on kubectl port-forward stream", async () => {
    expect(parseForwardedPort("unrelated\n")).toBeUndefined();
    expect(
      parseForwardedPort("Forwarding from 127.0.0.1:54321 -> 1234\n"),
    ).toBe(54_321);

    const okStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode("Forwarding from 127.0.0.1:41234 -> 1234\n"),
        );
        controller.close();
      },
    });
    const neverExit = Promise.withResolvers<number>().promise;
    expect(await waitForPortForwardPort(okStream, neverExit, 2000)).toBe(
      41_234,
    );

    const earlyExitStream = new TransformStream<Uint8Array, Uint8Array>()
      .readable;
    await expect(
      waitForPortForwardPort(earlyExitStream, Promise.resolve(1), 2000),
    ).rejects.toThrow(/exited prematurely/u);

    const emptyDoneStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });
    await expect(
      waitForPortForwardPort(emptyDoneStream, neverExit, 50),
    ).rejects.toThrow(/Timed out waiting/u);

    const hangingStream = new TransformStream<Uint8Array, Uint8Array>()
      .readable;
    await expect(
      waitForPortForwardPort(hangingStream, neverExit, 10),
    ).rejects.toThrow(/Timed out waiting/u);
  });

  test("exercises resolveHeadCommit, execReleaseCommand, and openKubectlPortForward lifecycle", async () => {
    const head = resolveHeadCommit(REPOSITORY_ROOT);
    expect(head).toMatch(/^[\da-f]{40}$/u);

    const nonGit = await mkdtemp(path.join(tmpdir(), "non-git-"));
    tempDirs.push(nonGit);
    await expect(
      execReleaseCommand(["git", "-C", nonGit, "rev-parse", "HEAD"], {
        cwd: nonGit,
        env: { ...Bun.env, GIT_CEILING_DIRECTORIES: path.dirname(nonGit) },
      }),
    ).rejects.toThrow(/Command failed/u);
    await execReleaseCommand(["true"], { cwd: nonGit, env: Bun.env });

    let killed = false;
    const exitDeferred = Promise.withResolvers<number>();
    const handle = await openKubectlPortForward(() => ({
      stdout: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              "Forwarding from 127.0.0.1:42345 -> 1234\n",
            ),
          );
          controller.close();
        },
      }),
      exited: exitDeferred.promise,
      kill: () => {
        killed = true;
        exitDeferred.resolve(0);
      },
    }));
    expect(handle.port).toBe(42_345);
    await handle.close();
    expect(killed).toBe(true);

    let failedKilled = false;
    await expect(
      openKubectlPortForward(() => ({
        stdout: new TransformStream<Uint8Array, Uint8Array>().readable,
        exited: Promise.resolve(2),
        kill: () => {
          failedKilled = true;
        },
      })),
    ).rejects.toThrow(/exited prematurely/u);
    expect(failedKilled).toBe(true);
  });
});

describe("site digest rewriting", () => {
  test("fails loudly when expected Astro digest anchors are missing", () => {
    expect(() =>
      rewriteWindowsAstro("const x = 1;", {
        base: BASE_DIGEST,
        winui: WINUI_DIGEST,
      }),
    ).toThrow(/Expected exactly one match/u);
    expect(() => rewriteIndexAstro("const x = 1;", BASE_DIGEST)).toThrow(
      /Expected exactly one match/u,
    );
  });
});

describe("releaseWindowsCrossCompiler", () => {
  test("builds both images, runs self-test, re-pins DIGEST/STATE/site files, and cleans up", async () => {
    const root = await createReleaseFixture();
    await mkdir(path.join(root, SELFTEST_REPORT_DIR), { recursive: true });
    await Bun.write(path.join(root, SELFTEST_REPORT_DIR, "report.txt"), "ok\n");

    const commands: string[][] = [];
    const seenDockerConfigs = new Set<string>();
    let portForwardClosed = false;

    const result = await releaseWindowsCrossCompiler(
      { releaseNumber: 99_999 },
      {
        root,
        pid: 4242,
        env: {
          PATH: "/usr/bin:/bin",
          OP_SERVICE_ACCOUNT_TOKEN: "should-strip",
        },
        resolveHeadCommit: async () => SOURCE_COMMIT,
        openPortForward: async () => ({
          port: 31_234,
          close: async () => {
            portForwardClosed = true;
          },
        }),
        runCommand: async (command, opts) => {
          commands.push([...command]);
          expect(opts.env["OP_SERVICE_ACCOUNT_TOKEN"]).toBeUndefined();
          const dockerCfg = opts.env["DOCKER_CONFIG"] ?? "";
          expect(dockerCfg).toContain("windows-cross-release-4242-");
          seenDockerConfigs.add(dockerCfg);
          expect(
            await Bun.file(path.join(dockerCfg, "config.json")).exists(),
          ).toBe(true);

          if (command[1] === "ci/scripts/images/build-ci-image.ts") {
            const imageIndex = command.indexOf("--image");
            const outIndex = command.indexOf("--candidate-out");
            const image = command[imageIndex + 1] ?? "";
            const outFile = command[outIndex + 1] ?? "";
            await Bun.write(
              outFile,
              JSON.stringify({
                schema: "ci-image-candidate/v1",
                image,
                buildNumber: 99_999,
                sourceCommit: SOURCE_COMMIT,
                sourceFingerprint: SOURCE_FINGERPRINT,
                digest:
                  image === "windows-cross-compiler"
                    ? BASE_DIGEST
                    : WINUI_DIGEST,
              }),
            );
          }
        },
      },
    );

    expect(commands.map((cmd) => cmd.slice(0, 4).join(" "))).toEqual([
      "docker buildx create --name",
      "bun ci/scripts/images/build-ci-image.ts --image windows-cross-compiler",
      "bun ci/scripts/images/build-ci-image.ts --image windows-cross-compiler-winui",
      "bun ci/scripts/images/selftest-ci-image.ts",
      "docker buildx rm --force",
    ]);
    expect(commands[0]).toContain("tcp://127.0.0.1:31234");
    expect(portForwardClosed).toBe(true);
    expect(
      await Bun.file(
        path.join(root, SELFTEST_REPORT_DIR, "report.txt"),
      ).exists(),
    ).toBe(false);
    for (const cfg of seenDockerConfigs) {
      expect(await Bun.file(path.join(cfg, "config.json")).exists()).toBe(
        false,
      );
    }

    for (const imageName of WINDOWS_IMAGES) {
      const expectedDigest =
        imageName === "windows-cross-compiler" ? BASE_DIGEST : WINUI_DIGEST;
      const digestText = await Bun.file(
        path.join(
          root,
          `packages/windows-cross-compiler/images/${imageName}/DIGEST`,
        ),
      ).text();
      expect(digestText).toBe(`${expectedDigest}\n`);
      const stateJson = await Bun.file(
        path.join(
          root,
          `packages/windows-cross-compiler/images/${imageName}/STATE.json`,
        ),
      ).json();
      expect(stateJson).toEqual({
        schema: "ci-image-pin-state/v1",
        buildNumber: 99_999,
        sourceCommit: SOURCE_COMMIT,
        sourceFingerprint: SOURCE_FINGERPRINT,
        digest: expectedDigest,
      });
    }

    const windowsAstro = await Bun.file(
      path.join(root, WINDOWS_ASTRO_PATH),
    ).text();
    expect(windowsAstro).toContain(
      `docker.io/shepherdjerred/windows-cross-compiler@${BASE_DIGEST}`,
    );
    expect(windowsAstro).toContain(
      `docker.io/shepherdjerred/windows-cross-compiler-winui@${WINUI_DIGEST}`,
    );
    expect(windowsAstro).toContain(`"sha256:${"a".repeat(12)}…"`);
    expect(windowsAstro).toContain(`"sha256:${"b".repeat(12)}…"`);

    const indexAstro = await Bun.file(path.join(root, INDEX_ASTRO_PATH)).text();
    expect(indexAstro).toContain(
      `docker.io/shepherdjerred/windows-cross-compiler@${BASE_DIGEST}`,
    );
    expect(result.modifiedFiles).toHaveLength(6);
    expect(formatReleaseSummary(result)).toContain(BASE_DIGEST);
  });

  test("refuses a stale releaseNumber and cleans up builder + port-forward when self-test fails", async () => {
    const root = await createReleaseFixture();
    await expect(
      releaseWindowsCrossCompiler({ releaseNumber: 1 }, { root }),
    ).rejects.toThrow(/must exceed/u);

    let portForwardClosed = false;
    const commands: string[][] = [];
    const originalDigest = await Bun.file(
      path.join(
        root,
        "packages/windows-cross-compiler/images/windows-cross-compiler/DIGEST",
      ),
    ).text();

    await expect(
      releaseWindowsCrossCompiler(
        { releaseNumber: 99_999, commit: SOURCE_COMMIT },
        {
          root,
          openPortForward: async () => ({
            port: 31_235,
            close: async () => {
              portForwardClosed = true;
            },
          }),
          runCommand: async (command) => {
            commands.push([...command]);
            if (command[1] === "ci/scripts/images/build-ci-image.ts") {
              const image = command[command.indexOf("--image") + 1] ?? "";
              const outFile =
                command[command.indexOf("--candidate-out") + 1] ?? "";
              await Bun.write(
                outFile,
                JSON.stringify({
                  schema: "ci-image-candidate/v1",
                  image,
                  buildNumber: 99_999,
                  sourceCommit: SOURCE_COMMIT,
                  sourceFingerprint: SOURCE_FINGERPRINT,
                  digest:
                    image === "windows-cross-compiler"
                      ? BASE_DIGEST
                      : WINUI_DIGEST,
                }),
              );
              return;
            }
            if (command[1] === "ci/scripts/images/selftest-ci-image.ts") {
              throw new Error("selftest failed");
            }
          },
        },
      ),
    ).rejects.toThrow("selftest failed");

    expect(portForwardClosed).toBe(true);
    expect(commands.at(-1)).toEqual([
      "docker",
      "buildx",
      "rm",
      "--force",
      "ci",
    ]);
    expect(
      await Bun.file(
        path.join(
          root,
          "packages/windows-cross-compiler/images/windows-cross-compiler/DIGEST",
        ),
      ).text(),
    ).toBe(originalDigest);
  });
});
