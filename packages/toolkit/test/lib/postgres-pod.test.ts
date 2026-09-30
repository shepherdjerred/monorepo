import { describe, expect, test } from "vitest";

import {
  masterPodQueryArgs,
  parseMajorVersion,
  pgBinaryPath,
  podExecArgs,
  selectReadyMasterPod,
} from "#lib/postgres/pod.ts";

const target = {
  namespace: "scout-beta",
  cluster: "scout-beta-postgresql",
} as const;

function pod(name: string, phase: string, ready: string) {
  return {
    metadata: { name, uid: `uid-${name}` },
    status: {
      conditions: [{ status: ready, type: "Ready" }],
      phase,
    },
  };
}

describe("pgBinaryPath", () => {
  test("names the version-matched binary rather than the one on PATH", () => {
    expect(pgBinaryPath(16, "pg_dump")).toBe(
      "/usr/lib/postgresql/16/bin/pg_dump",
    );
    expect(pgBinaryPath(18, "pg_restore")).toBe(
      "/usr/lib/postgresql/18/bin/pg_restore",
    );
  });

  test("refuses a version that cannot be a major", () => {
    expect(() => pgBinaryPath(0, "psql")).toThrow("positive integer");
    expect(() => pgBinaryPath(16.13, "psql")).toThrow("positive integer");
  });
});

describe("parseMajorVersion", () => {
  test("reads the major from a packaged server_version", () => {
    expect(parseMajorVersion("16.13 (Ubuntu 16.13-1.pgdg22.04+1)")).toBe(16);
    expect(parseMajorVersion("18.3\n")).toBe(18);
  });

  test("throws instead of guessing when there is no version", () => {
    expect(() => parseMajorVersion("")).toThrow(
      "Could not read a PostgreSQL major version",
    );
    expect(() => parseMajorVersion("unknown")).toThrow(
      "Could not read a PostgreSQL major version",
    );
  });
});

describe("selectReadyMasterPod", () => {
  test("returns the single ready pod with its uid", () => {
    const selected = selectReadyMasterPod(
      { items: [pod("scout-beta-postgresql-0", "Running", "True")] },
      target,
    );
    expect(selected).toEqual({
      name: "scout-beta-postgresql-0",
      uid: "uid-scout-beta-postgresql-0",
    });
  });

  test("ignores a pod that is running but not ready", () => {
    expect(() =>
      selectReadyMasterPod(
        { items: [pod("scout-beta-postgresql-0", "Running", "False")] },
        target,
      ),
    ).toThrow("found 0");
  });

  test("ignores a pod that is ready but not running", () => {
    expect(() =>
      selectReadyMasterPod(
        { items: [pod("scout-beta-postgresql-0", "Pending", "True")] },
        target,
      ),
    ).toThrow("found 0");
  });

  test("refuses an ambiguous match rather than picking one", () => {
    expect(() =>
      selectReadyMasterPod(
        {
          items: [
            pod("scout-beta-postgresql-0", "Running", "True"),
            pod("scout-beta-postgresql-1", "Running", "True"),
          ],
        },
        target,
      ),
    ).toThrow(
      "Expected exactly one ready master pod for scout-beta-postgresql in scout-beta, found 2",
    );
  });

  test("rejects output that is not a pod list", () => {
    expect(() => selectReadyMasterPod({ items: [{}] }, target)).toThrow();
  });
});

describe("argv builders", () => {
  test("selects the master by Spilo labels, not by name prefix", () => {
    expect(masterPodQueryArgs(target)).toEqual([
      "kubectl",
      "get",
      "pods",
      "--namespace",
      "scout-beta",
      "--selector",
      "application=spilo,cluster-name=scout-beta-postgresql,spilo-role=master",
      "--output",
      "json",
    ]);
  });

  test("omits the container flag when no container is named", () => {
    expect(
      podExecArgs({
        namespace: "scout-beta",
        pod: "scout-beta-postgresql-0",
        command: ["psql", "--version"],
      }),
    ).toEqual([
      "kubectl",
      "exec",
      "--namespace",
      "scout-beta",
      "scout-beta-postgresql-0",
      "--",
      "psql",
      "--version",
    ]);
  });

  test("passes the container through when one is named", () => {
    expect(
      podExecArgs({
        namespace: "scout-beta",
        pod: "scout-beta-postgresql-0",
        container: "postgres",
        command: ["psql"],
      }),
    ).toEqual([
      "kubectl",
      "exec",
      "--namespace",
      "scout-beta",
      "--container",
      "postgres",
      "scout-beta-postgresql-0",
      "--",
      "psql",
    ]);
  });
});
