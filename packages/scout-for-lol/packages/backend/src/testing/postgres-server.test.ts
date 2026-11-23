import { afterEach, describe, expect, test, vi } from "vitest";
import { homedir, tmpdir } from "node:os";

import {
  assertDevPostgresIdentity,
  devPostgresDataRoot,
} from "./postgres-server.ts";

afterEach(() => {
  vi.unstubAllEnvs();
});

test("uses the native home directory when Windows has no HOME or XDG override", () => {
  vi.stubEnv("HOME", undefined);
  vi.stubEnv("XDG_DATA_HOME", undefined);
  const expected =
    process.getuid?.() === 0
      ? `${tmpdir()}/scout-for-lol/postgres/18`
      : `${homedir()}/.local/share/scout-for-lol/postgres/18`;
  expect(devPostgresDataRoot()).toBe(expected);
});

describe("dev PostgreSQL ownership", () => {
  const directory = "/local/scout-for-lol/postgres/18/pgdata";

  test("accepts PostgreSQL 18 from the harness data directory", () => {
    expect(() =>
      assertDevPostgresIdentity(180_006, directory, directory),
    ).not.toThrow();
  });

  test("refuses a PostgreSQL 16 server on the same port", () => {
    expect(() =>
      assertDevPostgresIdentity(160_015, directory, directory),
    ).toThrow("requires major 18");
  });

  test("refuses another PostgreSQL 18 server on the same port", () => {
    expect(() =>
      assertDevPostgresIdentity(180_006, "/unrelated/pgdata", directory),
    ).toThrow("port belongs to");
  });
});
