import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

import type { AppError } from "../../../domain/errors";
import {
  ApiError,
  ConnectionError,
  NetworkError,
  NotFoundError,
  ValidationError,
} from "../../../domain/errors";
import { deserializeAppError, serializeAppError } from "./fixtures/errors";
import { SCHEMA_PATH, loadScenarios, readRawScenarios } from "./fixtures/load";
import { ScenarioSchema, scenarioJsonSchema } from "./fixtures/schema";

/**
 * Guards on the shared fixture corpus itself.
 *
 * The corpus only works as an anti-drift mechanism if the format cannot rot:
 * the committed JSON Schema (which the Rust runner validates against) has to
 * stay generated from `fixtures/schema.ts`, no fixture may carry a key the
 * reader silently drops, and errors have to survive the round trip through
 * their serialized form.
 */

const SOURCES = [
  "src/data/sync/__tests__/harness.test.ts",
  "src/data/sync/__tests__/offline-scenarios.test.ts",
];

/** Attach the offending fixture to whatever the matcher reported. */
function withContext(context: string, check: () => void): void {
  try {
    check();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${context}\n${detail}`, { cause: error });
  }
}

describe("scenario corpus", () => {
  test("every fixture parses against the scenario schema", () => {
    // `loadScenarios` throws with the Zod issues on any invalid fixture and
    // on any id that disagrees with its file name.
    expect(loadScenarios().length).toBeGreaterThan(0);
  });

  test("no fixture key is silently dropped by the reader", () => {
    for (const { file, raw } of readRawScenarios()) {
      // Strict objects everywhere mean a parsed scenario must be deeply
      // identical to the file — anything else is a key the format does not
      // actually understand.
      withContext(file, () => {
        expect<unknown>(ScenarioSchema.parse(raw)).toEqual(raw);
      });
    }
  });

  test("scenario ids are unique", () => {
    const ids = loadScenarios().map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every scenario names a test file that runs it", () => {
    for (const scenario of loadScenarios()) {
      withContext(scenario.id, () => {
        expect(SOURCES).toContain(scenario.source);
      });
    }
  });

  test("every scenario asserts something", () => {
    for (const scenario of loadScenarios()) {
      withContext(scenario.id, () => {
        expect(scenario.assertions.length).toBeGreaterThan(0);
      });
    }
  });
});

describe("committed JSON Schema", () => {
  test("matches the schema module it is generated from", () => {
    const generated = scenarioJsonSchema();
    if (Bun.env["UPDATE_FIXTURE_SCHEMA"] === "1") {
      writeFileSync(SCHEMA_PATH, `${JSON.stringify(generated, null, 2)}\n`);
    }
    const committed: unknown = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
    withContext(
      "packages/tasknotes-fixtures/schema/scenario.schema.json is stale; regenerate with UPDATE_FIXTURE_SCHEMA=1 bun run test -- src/data/sync/__tests__/fixtures.test.ts",
      () => {
        expect<unknown>(committed).toEqual(generated);
      },
    );
  });
});

describe("AppError serialization", () => {
  const cases: readonly AppError[] = [
    new NetworkError("request failed"),
    new ApiError("boom", 500),
    new ValidationError("bad shape"),
    new NotFoundError("Task", "TaskNotes/gone.md"),
    new ConnectionError("Unable to connect to TaskNotes server"),
  ];

  test("every variant round-trips through its serialized form", () => {
    for (const error of cases) {
      const wire = serializeAppError(error);
      const restored = deserializeAppError(wire);
      withContext(error.name, () => {
        expect<string>(restored.kind).toBe(error.kind);
        expect(restored.message).toBe(error.message);
        expect(restored.name).toBe(error.name);
        expect<unknown>(serializeAppError(restored)).toEqual(wire);
      });
    }
  });

  test("status is present exactly on api and not_found", () => {
    for (const error of cases) {
      const wire = serializeAppError(error);
      withContext(error.name, () => {
        expect("status" in wire).toBe(
          error.kind === "api" || error.kind === "not_found",
        );
      });
    }
  });

  test("a not_found message that lost its shape fails loudly", () => {
    expect(() => {
      deserializeAppError({ kind: "not_found", message: "gone", status: 404 });
    }).toThrow(/not_found fixture error message/u);
  });
});
