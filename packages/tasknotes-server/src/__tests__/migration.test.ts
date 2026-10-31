import { describe, expect, test } from "vitest";
import { parseFrontmatter, resolveModelConfig } from "tasknotes-types/v2";

import { migrateVaultFile } from "../migration/migrate.ts";

const config = resolveModelConfig();

const LEGACY_SERVER_FILE = `---
id: 1a2b3c4d
title: Old server task
status: open
priority: normal
due: "2026-07-10"
tags:
  - seeded
---

Body text stays.
`;

describe("migrateVaultFile", () => {
  test("migration preserves retired metadata as opaque data", () => {
    const source = LEGACY_SERVER_FILE.replace(
      "priority: normal",
      "priority: normal\ntimeEntries: [vendor-entry]\ntimeEstimate: unknown\npomodoro: {vendor: true}",
    );
    const result = migrateVaultFile(source, config);
    const original = parseFrontmatter(source);
    const migrated = parseFrontmatter(result.content);
    for (const key of ["timeEntries", "timeEstimate", "pomodoro"]) {
      expect(migrated.frontmatter[key]).toEqual(original.frontmatter[key]);
    }
    expect(migrated.body).toBe(original.body);
  });

  test("adds the task tag, drops the injected id, keeps everything else", () => {
    const result = migrateVaultFile(LEGACY_SERVER_FILE, config);
    expect(result.changed).toBe(true);
    expect(result.actions).toEqual(['add tag "task"', "drop injected id key"]);
    expect(result.content).toContain("- task");
    expect(result.content).toContain("- seeded");
    expect(result.content).not.toContain("id: 1a2b3c4d");
    expect(result.content).toContain("Body text stays.");
    expect(result.content).toContain("due:");
  });

  test("is idempotent: migrating the output changes nothing", () => {
    const first = migrateVaultFile(LEGACY_SERVER_FILE, config);
    const second = migrateVaultFile(first.content, config);
    expect(second.changed).toBe(false);
    expect(second.content).toBe(first.content);
  });

  test("non-task markdown is untouched", () => {
    const note = "# Just a note\n\nNo task frontmatter.\n";
    const result = migrateVaultFile(note, config);
    expect(result.changed).toBe(false);
    expect(result.content).toBe(note);
  });

  test("a plugin-authored file (already tagged, no id) is untouched", () => {
    const pluginFile = `---
title: Plugin task
status: open
tags:
  - task
---
`;
    const result = migrateVaultFile(pluginFile, config);
    expect(result.changed).toBe(false);
  });

  test("a non-task note with title+status but no injected id is untouched", () => {
    // A random note that merely happens to carry `title`/`status` frontmatter
    // must not be false-tagged: only old-server files (which always stamped an
    // injected `id`) get migrated.
    const note = `---
title: Meeting notes
status: draft
---

Not a TaskNotes task.
`;
    const result = migrateVaultFile(note, config);
    expect(result.changed).toBe(false);
    expect(result.content).toBe(note);
  });
});
