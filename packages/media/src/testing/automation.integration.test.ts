import { expect, test } from "vitest";
import { automationTestHarness, ensureTestProvider } from "./automation.ts";

const { database } = automationTestHarness();

test("overlapping provider initialization creates one row without overwriting its policy", async () => {
  await Promise.all([
    ensureTestProvider(database()),
    ensureTestProvider(database()),
    ensureTestProvider(database()),
  ]);
  expect(
    await database().mediaProvider.count({ where: { id: "knaben" } }),
  ).toBe(1);
  await database().mediaProvider.update({
    where: { id: "knaben" },
    data: { enabled: false },
  });
  await ensureTestProvider(database());
  const provider = await database().mediaProvider.findUniqueOrThrow({
    where: { id: "knaben" },
  });
  expect(provider.enabled).toBe(false);
});
