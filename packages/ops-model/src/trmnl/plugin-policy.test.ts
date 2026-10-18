import { expect, test } from "vitest";
import {
  MAX_TRMNL_PLUGIN_BYTES,
  TRMNL_PLUGIN_POLICY,
  parseTrmnlPluginBundle,
  serializeTrmnlPluginBundle,
} from "./plugin-policy.ts";

function fixture() {
  return {
    schema: "delivery-trmnl-plugins/v1" as const,
    sourceRevision: "a".repeat(40),
    plugins: TRMNL_PLUGIN_POLICY.plugins.map((target) => ({
      ...target,
      files: Object.fromEntries(
        TRMNL_PLUGIN_POLICY.files.map((name) => [
          name,
          name === "settings.yml"
            ? `id: ${String(target.id)}\n`
            : "{{ payload }}",
        ]),
      ),
    })),
  };
}
test("fixed targets and exact source files serialize deterministically", () => {
  const original = fixture();
  const bytes = serializeTrmnlPluginBundle(original);
  expect(
    serializeTrmnlPluginBundle({
      ...original,
      plugins: original.plugins.toReversed().map((plugin) => ({
        ...plugin,
        files: Object.fromEntries(Object.entries(plugin.files).toReversed()),
      })),
    }),
  ).toBe(bytes);
  expect(parseTrmnlPluginBundle(bytes)).toEqual(original);
});
test("unknown targets, unsafe files, duplicates and oversized or invalid UTF8 fail closed", () => {
  const original = fixture();
  const first = original.plugins[0];
  if (first === undefined) throw new Error("Missing fixture plugin");
  for (const plugins of [
    original.plugins.map((plugin) => ({ ...plugin, id: 1 })),
    [first, first, first],
    original.plugins.map((plugin) => ({
      ...plugin,
      files: { ...plugin.files, "../secret": "bad" },
    })),
  ])
    expect(() =>
      serializeTrmnlPluginBundle({ ...original, plugins }),
    ).toThrow();
  expect(() =>
    parseTrmnlPluginBundle(new Uint8Array(MAX_TRMNL_PLUGIN_BYTES + 1)),
  ).toThrow(/2MiB/u);
  expect(() => parseTrmnlPluginBundle(new Uint8Array([255]))).toThrow();
});
