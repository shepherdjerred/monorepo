import { describe, expect, test } from "vitest";

import {
  collectConsumption,
  snapshotStalenessWarning,
  validateDesiredStateTargets,
} from "./check-1password-items.ts";
import {
  hash,
  snapshotFieldSelectors,
  type OpItem,
  type SnapshotItem,
} from "./onepassword-lib.ts";

const NOW = new Date("2026-08-16T00:00:00Z");

describe("desired-state handoff selectors", () => {
  const item: OpItem = {
    id: "fixture-item",
    title: "Fixture",
    fields: [
      { id: "top-level", label: "TOKEN", value: "synthetic-token" },
      {
        id: "section-field",
        label: "TOKEN",
        section: { id: "section" },
        value: "synthetic-section-token",
      },
      { id: "other-field", label: "OTHER", value: "synthetic-other-token" },
    ],
  };
  const snapshot: SnapshotItem = {
    ref: hash(item.id),
    title: hash(item.title),
    fields: [hash("TOKEN"), hash("OTHER")],
    blankFields: [],
    fieldSelectors: snapshotFieldSelectors(item),
  };
  const byHash = new Map([[snapshot.ref, snapshot]]);
  const target = {
    vault_item_id: item.id,
    vault_field: "TOKEN",
    vault_field_id: "section-field",
    vault_section_id: "section",
  };

  test("accepts selectors belonging to one physical field", () => {
    const errors: string[] = [];
    expect(
      validateDesiredStateTargets(
        [{ platform: "application-secrets", target }],
        byHash,
        errors,
      ),
    ).toBe(1);
    expect(errors).toEqual([]);
  });

  test.each([
    { ...target, vault_field_id: "misspelled-field" },
    { ...target, vault_section_id: "wrong-section" },
    { ...target, vault_section_id: undefined },
    { ...target, vault_field_id: "top-level" },
    {
      ...target,
      vault_field_id: "other-field",
      vault_section_id: undefined,
    },
  ])("rejects mismatched physical selectors: %j", (invalidTarget) => {
    const errors: string[] = [];
    validateDesiredStateTargets(
      [{ platform: "application-secrets", target: invalidTarget }],
      byHash,
      errors,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("do not identify exactly one field");
  });

  test("supports a unique application label without a field ID", () => {
    const errors: string[] = [];
    validateDesiredStateTargets(
      [
        {
          platform: "application-secrets",
          target: { vault_item_id: item.id, vault_field: "TOKEN" },
        },
      ],
      byHash,
      errors,
    );
    expect(errors).toEqual([]);
  });

  test("rejects an ambiguous label without a field ID", () => {
    const duplicate = snapshotFieldSelectors({
      ...item,
      fields: [...(item.fields ?? []), { id: "duplicate", label: "TOKEN" }],
    });
    const errors: string[] = [];
    validateDesiredStateTargets(
      [
        {
          platform: "application-secrets",
          target: { vault_item_id: item.id, vault_field: "TOKEN" },
        },
      ],
      new Map([[snapshot.ref, { ...snapshot, fieldSelectors: duplicate }]]),
      errors,
    );
    expect(errors).toHaveLength(1);
  });

  test("snapshot selectors are independent of credential values", () => {
    expect(
      snapshotFieldSelectors({
        ...item,
        fields: item.fields?.map((field) => ({
          ...field,
          value: "rotated-fixture",
        })),
      }),
    ).toEqual(snapshot.fieldSelectors);
    expect(JSON.stringify(snapshot.fieldSelectors)).not.toContain("synthetic");
  });
});

describe("collectConsumption", () => {
  test("includes a nested Helm-managed Minecraft RCON secret", () => {
    const consumed = new Map<string, Set<string>>();
    collectConsumption(
      {
        spec: {
          source: {
            helm: {
              valuesObject: {
                minecraftServer: {
                  rcon: {
                    enabled: true,
                    withGeneratedPassword: false,
                    existingSecret: "minecraft-tsmc-brain",
                    secretKey: "MINECRAFT_RCON_PASSWORD",
                  },
                },
              },
            },
          },
        },
      },
      consumed,
    );
    expect(consumed.get("minecraft-tsmc-brain")).toEqual(
      new Set(["MINECRAFT_RCON_PASSWORD"]),
    );
  });

  test("ignores RCON when the chart generates its own password", () => {
    const consumed = new Map<string, Set<string>>();
    collectConsumption(
      {
        minecraftServer: {
          rcon: {
            enabled: true,
            withGeneratedPassword: true,
            existingSecret: "unused",
            secretKey: "unused",
          },
        },
      },
      consumed,
    );
    expect(consumed.size).toBe(0);
  });
});

describe("snapshotStalenessWarning", () => {
  test("stays quiet for a recently refreshed snapshot", () => {
    // The snapshot legitimately ages between vault changes, so a fresh-enough
    // one must not nag on PRs that touched nothing related.
    expect(
      snapshotStalenessWarning("2026-08-11T02:11:02.518Z", NOW),
    ).toBeNull();
  });

  test("reports the age once the snapshot is too old to trust", () => {
    // A clean result against a stale snapshot means "nothing contradicts an
    // old record", not "the vault agrees" — say so rather than imply coverage.
    const warning = snapshotStalenessWarning("2026-01-01T00:00:00Z", NOW);
    expect(warning).toContain("227 days old");
    expect(warning).toContain("snapshot-1password-vault.ts");
  });

  test("treats an unparseable timestamp as a refresh prompt", () => {
    expect(snapshotStalenessWarning("not-a-date", NOW)).toContain(
      "unparseable generatedAt",
    );
  });

  test("honours the boundary exactly", () => {
    const exactly = new Date(NOW.getTime() - 45 * 24 * 60 * 60 * 1000);
    expect(snapshotStalenessWarning(exactly.toISOString(), NOW)).toBeNull();
    const oneDayPast = new Date(NOW.getTime() - 46 * 24 * 60 * 60 * 1000);
    expect(snapshotStalenessWarning(oneDayPast.toISOString(), NOW)).toContain(
      "46 days old",
    );
  });
});
