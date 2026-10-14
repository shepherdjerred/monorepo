import { expect, test } from "vitest";
import { AuthoredCombatHost } from "./wire.ts";
import { configureHostFeatures, requireEditableHost } from "./settings.ts";
import { setRwfFeatures, startFakeBrain } from "#e2e/harness/fake-brain.ts";

const human = "33333333-3333-4333-8333-333333333333";
const host = AuthoredCombatHost.parse({
  match: "11111111-1111-4111-8111-111111111111",
  enabled: true,
  host: human,
  locked: false,
  selectedDifficulty: "NORMAL",
  currentDifficulty: "NORMAL",
});

test("public host editing requires the original unlocked human-owned session", () => {
  expect(() => requireEditableHost(host, human)).not.toThrow();
  for (const change of [
    { enabled: false },
    { host: null },
    { host: "44444444-4444-4444-8444-444444444444" },
    { locked: true, selectedDifficulty: "HARD" as const },
  ])
    expect(() => requireEditableHost({ ...host, ...change }, human)).toThrow();
});

test("private proof enables actual host and candidate features before the first ordinary lobby", async () => {
  const brain = startFakeBrain(crypto.randomUUID());
  try {
    const configured = await configureHostFeatures(brain.port);
    expect(configured.previous).toEqual([]);
    expect(configured.appliesBeforeBoot).toBe(true);
    expect(await setRwfFeatures(brain.port, [])).toEqual([
      "the-storm-rwf-match-flow-enabled",
      "the-storm-rwf-host-settings-enabled",
      "the-storm-rwf-candidate-visits-enabled",
    ]);
  } finally {
    await brain.stop();
  }
});
