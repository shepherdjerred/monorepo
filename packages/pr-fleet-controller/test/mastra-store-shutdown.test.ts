import { describe, expect, test } from "bun:test";
import { shutdownMastraStores } from "@shepherdjerred/pr-fleet-controller/src/mastra-store-shutdown.ts";

describe("Mastra store shutdown", () => {
  test("closes both concrete stores after earlier cleanup failures", async () => {
    const calls: string[] = [];
    const shutdownFailure = new Error("Mastra shutdown failed");
    const permissionFailure = new Error("Permission sweep failed");
    const closeFailure = new Error("DuckDB close failed");

    const settlement = shutdownMastraStores({
      shutdownMastra: () => {
        calls.push("mastra");
        return Promise.reject(shutdownFailure);
      },
      secureArtifacts: () => {
        calls.push("permissions");
        return Promise.reject(permissionFailure);
      },
      closeDuckdb: () => {
        calls.push("duckdb");
        return Promise.reject(closeFailure);
      },
      closeLibsql: () => {
        calls.push("libsql");
        return Promise.resolve();
      },
    });

    await expect(settlement).rejects.toEqual(
      new AggregateError(
        [shutdownFailure, permissionFailure, closeFailure],
        "Failed to shut down Mastra storage",
      ),
    );
    expect(calls).toEqual(["mastra", "permissions", "duckdb", "libsql"]);
  });
});
