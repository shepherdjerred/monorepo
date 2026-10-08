import { describe, expect, test } from "vitest";

import { assertDevPostgresIdentity } from "./postgres-server.ts";

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
