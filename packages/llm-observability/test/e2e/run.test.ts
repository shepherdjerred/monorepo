import { expect, test } from "vitest";
import {
  E2E_MINIO_HOST_VARIABLE,
  E2E_TEMPO_HOST_VARIABLE,
  GATEWAY_ARCHIVE_E2E_TIMEOUT_MS,
  TEMPO_TRACE_POLL_TIMEOUT_MS,
  e2eEnvironment,
  waitForTempo,
} from "./run-core.ts";

test("passes the selected service hosts to the e2e process", () => {
  expect(e2eEnvironment({ tempo: "tempo", minio: "minio" })).toEqual({
    [E2E_TEMPO_HOST_VARIABLE]: "tempo",
    [E2E_MINIO_HOST_VARIABLE]: "minio",
  });
});

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

test("gateway archive e2e outlives the Tempo poll deadline", async () => {
  expect(GATEWAY_ARCHIVE_E2E_TIMEOUT_MS).toBeGreaterThan(
    TEMPO_TRACE_POLL_TIMEOUT_MS,
  );
  const gatewayTest = await Bun.file(
    new URL("gateway-archive.e2e.test.ts", import.meta.url),
  ).text();
  const poll = await Bun.file(new URL("helpers.ts", import.meta.url)).text();
  expect(gatewayTest).toContain("GATEWAY_ARCHIVE_E2E_TIMEOUT_MS,");
  expect(poll).toContain("options.timeoutMs ?? TEMPO_TRACE_POLL_TIMEOUT_MS");
});
