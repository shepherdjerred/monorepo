import { expect, test } from "vitest";
import {
  E2E_MINIO_HOST_VARIABLE,
  E2E_TEMPO_HOST_VARIABLE,
  e2eEnvironment,
  waitForTempo,
} from "./run-core.ts";

test("stops checking once Tempo is ready", async () => {
  let attempts = 0;
  await waitForTempo(async () => {
    attempts += 1;
    return true;
  }, 2);
  expect(attempts).toBe(1);
});

test("fails after the configured attempts", async () => {
  await expect(waitForTempo(async () => false, 1, 0)).rejects.toThrow(
    "Tempo did not become ready",
  );
});

/**
 * The suite reads these names; compose serves both on localhost, while
 * Woodpecker runs each as its own pod reached by service name.
 */
test("hands the suite each service's host under the names it reads", () => {
  expect(e2eEnvironment({ tempo: "tempo", minio: "minio" })).toEqual({
    [E2E_TEMPO_HOST_VARIABLE]: "tempo",
    [E2E_MINIO_HOST_VARIABLE]: "minio",
  });
  expect(E2E_TEMPO_HOST_VARIABLE).toBe("LLM_OBSERVABILITY_E2E_TEMPO_HOST");
  expect(E2E_MINIO_HOST_VARIABLE).toBe("LLM_OBSERVABILITY_E2E_MINIO_HOST");
});
