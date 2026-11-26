import { managedFlagInventory } from "@shepherdjerred/feature-flags/managed-flag-inventory.ts";
import type { ConfigSource } from "@shepherdjerred/config/source.ts";
import { describe, expect, it, vi } from "vitest";
import {
  createIncidentsFlagReader,
  DEFAULT_INCIDENTS_SETTINGS,
  INCIDENTS_FLAG_KEYS,
} from "#infrastructure/flags.ts";

function source(
  values: Record<string, unknown>,
  failing: readonly string[] = [],
): ConfigSource {
  return {
    name: "flag",
    get: async (names) => {
      if (failing.includes(names.flag)) throw new Error("flags unavailable");
      return names.flag in values ? { value: values[names.flag] } : undefined;
    },
  };
}

describe("incidents flags", () => {
  it("declares every key in the alert-dashboard namespace with matching defaults", () => {
    const keys = new Map<string, string>(Object.entries(INCIDENTS_FLAG_KEYS));
    for (const [field, fallback] of Object.entries(
      DEFAULT_INCIDENTS_SETTINGS,
    )) {
      const flag = managedFlagInventory.flags.find(
        (candidate) => candidate.key === keys.get(field),
      );
      expect(flag?.namespace).toBe("alert-dashboard");
      expect(flag?.default).toBe(
        typeof fallback === "number" ? String(fallback) : fallback,
      );
    }
    expect(DEFAULT_INCIDENTS_SETTINGS).toEqual({
      enabled: true,
      autoOpenAlertmanager: true,
      autoOpenMainCi: true,
      takeoverGraceSeconds: 600,
      dispatchLeaseSeconds: 600,
      takeoverSpawnEnabled: true,
      takeoverProvider: "claude-code",
    });
  });

  it("uses defaults when the flag layer has no opinion", async () => {
    await expect(createIncidentsFlagReader(source({})).read()).resolves.toEqual(
      DEFAULT_INCIDENTS_SETTINGS,
    );
  });

  it("honors explicit false and zero", async () => {
    const settings = await createIncidentsFlagReader(
      source({
        [INCIDENTS_FLAG_KEYS.enabled]: false,
        [INCIDENTS_FLAG_KEYS.takeoverGraceSeconds]: 0,
        [INCIDENTS_FLAG_KEYS.takeoverProvider]: "codex",
      }),
    ).read();
    expect(settings).toMatchObject({
      enabled: false,
      takeoverGraceSeconds: 0,
      takeoverProvider: "codex",
    });
  });

  it("throws on a present invalid value", async () => {
    await expect(
      createIncidentsFlagReader(
        source({ [INCIDENTS_FLAG_KEYS.dispatchLeaseSeconds]: -5 }),
      ).read(),
    ).rejects.toThrow();
  });

  it("falls back to the default and warns when the source fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => null);
    const settings = await createIncidentsFlagReader(
      source({}, [INCIDENTS_FLAG_KEYS.autoOpenMainCi]),
    ).read();
    expect(settings.autoOpenMainCi).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("incidents_config_source_error"),
    );
    warn.mockRestore();
  });
});
