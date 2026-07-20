import { afterEach, beforeEach, describe, expect, test } from "bun:test";

const configureScript = `${import.meta.dir}/../.buildkite/scripts/configure-buildx-driver.sh`;

type RunResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

let temporaryDirectory = "";
let dockerLog = "";

async function run(
  command: string[],
  env: Record<string, string>,
): Promise<RunResult> {
  const process = Bun.spawn(command, {
    env: {
      ...Bun.env,
      ...env,
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
    new Response(process.stdout).text(),
  ]);
  return { exitCode, stderr, stdout };
}

beforeEach(async () => {
  const result = await run(
    ["mktemp", "-d", "-t", "ci-buildx-driver.XXXXXX"],
    {},
  );
  expect(result.exitCode).toBe(0);
  temporaryDirectory = result.stdout.trim();
  dockerLog = `${temporaryDirectory}/docker.log`;

  const fakeDocker = `${temporaryDirectory}/docker`;
  await Bun.write(
    fakeDocker,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$FAKE_DOCKER_LOG"
case "$1 $2" in
  "buildx ls")
    printf '%s\n' "\${FAKE_BUILDERS:-}"
    ;;
  "buildx create")
    printf '%s\n' "$4"
    ;;
  "info --format")
    printf '%s\n' "\${FAKE_DRIVER_STATUS:-[]}"
    ;;
  "buildx inspect")
    printf 'Name: default\nDriver: %s\n' "\${FAKE_DEFAULT_DRIVER:-docker}"
    ;;
  *)
    printf 'unexpected docker invocation: %s\n' "$*" >&2
    exit 90
    ;;
esac
`,
  );
  const chmod = await run(["chmod", "+x", fakeDocker], {});
  expect(chmod.exitCode).toBe(0);
});

afterEach(async () => {
  expect(temporaryDirectory).toContain("ci-buildx-driver.");
  const result = await run(["rm", "-rf", temporaryDirectory], {});
  expect(result.exitCode).toBe(0);
});

async function configure(env: Record<string, string>): Promise<RunResult> {
  return run(["bash", configureScript], {
    FAKE_DOCKER_LOG: dockerLog,
    PATH: `${temporaryDirectory}:${Bun.env["PATH"] ?? ""}`,
    ...env,
  });
}

describe("configure-buildx-driver", () => {
  test("creates and selects the current docker-container builder", async () => {
    const result = await configure({});

    expect(result).toEqual({ exitCode: 0, stderr: "", stdout: "ci\n" });
    expect(await Bun.file(dockerLog).text()).toContain(
      "buildx create --name ci --driver docker-container",
    );
  });

  test("reuses an existing docker-container builder", async () => {
    const result = await configure({ FAKE_BUILDERS: "ci" });

    expect(result).toEqual({ exitCode: 0, stderr: "", stdout: "ci\n" });
    expect(await Bun.file(dockerLog).text()).toBe(
      "buildx ls --format {{.Name}}\n",
    );
  });

  test("selects the default builder only with the containerd image store", async () => {
    const result = await configure({
      CI_BUILDX_MODE: "containerd-default",
      FAKE_DRIVER_STATUS: '[["driver-type","io.containerd.snapshotter.v1"]]',
    });

    expect(result).toEqual({ exitCode: 0, stderr: "", stdout: "default\n" });
    expect(await Bun.file(dockerLog).text()).toContain(
      "buildx inspect default",
    );
  });

  test("rejects the candidate when Docker uses the legacy image store", async () => {
    const result = await configure({
      CI_BUILDX_MODE: "containerd-default",
      FAKE_DRIVER_STATUS: "[]",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "containerd-default requires Docker's containerd image store",
    );
    expect(await Bun.file(dockerLog).text()).not.toContain(
      "buildx inspect default",
    );
  });

  test("rejects a non-Docker default builder", async () => {
    const result = await configure({
      CI_BUILDX_MODE: "containerd-default",
      FAKE_DEFAULT_DRIVER: "docker-container",
      FAKE_DRIVER_STATUS: '[["driver-type","io.containerd.snapshotter.v1"]]',
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "default Buildx builder uses 'docker-container', expected 'docker'",
    );
  });

  test("rejects an unknown mode", async () => {
    const result = await configure({ CI_BUILDX_MODE: "surprise" });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("unknown CI_BUILDX_MODE 'surprise'");
  });
});
