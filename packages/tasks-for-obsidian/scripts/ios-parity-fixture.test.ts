import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { followingDay } from "tasknotes-macos/scripts/occurrence-acceptance/fixture.ts";
import {
  capturedTitle,
  parityFixture,
  reschedulePath,
  savedViewTitle,
  searchTag,
  timedViewerPath,
  seedParityVault,
  verifyParityVault,
} from "./ios-parity-fixture.ts";
import { timedViewerWitness } from "./native-acceptance/timed-viewer-witness.ts";

const day = "2026-10-30";

async function fixture(body: (vault: string) => Promise<void>): Promise<void> {
  const directory = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "facet-ios-parity-fixture-")),
  );
  try {
    const vault = path.join(directory, "vault");
    await seedParityVault(vault, day);
    await body(vault);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function mutated(vault: string, view = false): Promise<void> {
  const source = parityFixture(day)[reschedulePath];
  if (source === undefined) throw new Error("Missing scheduling fixture");
  await Bun.write(
    path.join(vault, reschedulePath),
    source.replace(
      "\n---\nReschedule body",
      `\nscheduled: '${followingDay(day)}'\n---\nReschedule body`,
    ),
  );
  await Bun.write(
    path.join(vault, "Tasks/Captured.md"),
    `---\ntitle: ${capturedTitle}\nstatus: open\ntags: [task]\nscheduled: '${day}'\n---\n`,
  );
  if (view) {
    await mkdir(path.join(vault, "Facet/Views"), { recursive: true });
    await Bun.write(
      path.join(vault, "Facet/Views/parity.md"),
      `---\nfacetView:\n  name: ${savedViewTitle}\n  favorite: true\n  query:\n    scope: all\n    tags: [${searchTag}]\n    sortField: title\n---\n`,
    );
  }
}

test("read-only parity rejects collateral reference changes", async () => {
  await fixture(async (vault) => {
    const verified = await verifyParityVault(vault, day, "collections");
    expect(Object.keys(verified.markdownHashes)).toHaveLength(8);
    await Bun.write(path.join(vault, "Reference.md"), "Changed reference\n");
    await expect(verifyParityVault(vault, day, "collections")).rejects.toThrow(
      "Collateral fixture change",
    );
  });
});

test.each(["2026-03-08", "2026-11-01"])(
  "timed witness preserves the viewer day across DST boundary %s",
  (viewerDay) => {
    const witness = timedViewerWitness(viewerDay);
    expect(witness.source.slice(0, 10)).not.toBe(viewerDay);
    expect(Date.parse(witness.source)).toBe(Date.parse(witness.instant));
    expect(witness.timeZone).toBe(
      new Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    expect(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: witness.timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(witness.source)),
    ).toBe(viewerDay);
    const canonicalCandidates = ["00:30:00", "23:30:00"].map((time) =>
      new Date(`${viewerDay}T${time}`).toISOString(),
    );
    if (
      canonicalCandidates.some((source) => source.slice(0, 10) !== viewerDay)
    ) {
      expect(witness.source.endsWith("Z")).toBe(true);
    }
  },
);

test.each(["collections", "mutations", "controls"] as const)(
  "every phase rejects changed timed source bytes: %s",
  async (phase) => {
    await fixture(async (vault) => {
      if (phase !== "collections") await mutated(vault, phase === "controls");
      await verifyParityVault(vault, day, phase);
      const witness = timedViewerWitness(day);
      const timed = path.join(vault, timedViewerPath);
      const original = await Bun.file(timed).text();
      expect(original).toContain(`due: '${witness.source}'`);
      await Bun.write(
        timed,
        original.replace(witness.source, `${day}T12:00:00Z`),
      );
      await expect(verifyParityVault(vault, day, phase)).rejects.toThrow(
        `Collateral fixture change: ${timedViewerPath}`,
      );
    });
  },
);

test("capture parity rejects the wrong persisted day and duplicate captures", async () => {
  await fixture(async (vault) => {
    await mutated(vault);
    await verifyParityVault(vault, day, "mutations");
    const captured = path.join(vault, "Tasks/Captured.md");
    const correct = await Bun.file(captured).text();
    await Bun.write(
      captured,
      correct.replace(
        `scheduled: '${day}'`,
        `scheduled: '${followingDay(day)}'`,
      ),
    );
    await expect(verifyParityVault(vault, day, "mutations")).rejects.toThrow();
    await Bun.write(captured, correct);
    await Bun.write(path.join(vault, "Tasks/Duplicate.md"), correct);
    await expect(verifyParityVault(vault, day, "mutations")).rejects.toThrow(
      "Unexpected added, missing or duplicate Markdown",
    );
  });
});

test.each([day, "null"])(
  "context-only capture rejects an unexpected deadline %s",
  async (deadline) => {
    await fixture(async (vault) => {
      await mutated(vault);
      await verifyParityVault(vault, day, "mutations");
      const captured = path.join(vault, "Tasks/Captured.md");
      const correct = await Bun.file(captured).text();
      await Bun.write(
        captured,
        correct.replace("\nstatus: open", `\ndue: ${deadline}\nstatus: open`),
      );
      await expect(verifyParityVault(vault, day, "mutations")).rejects.toThrow(
        "Context-only capture must not invent a deadline",
      );
    });
  },
);

test.each([
  {
    label: "opaque history",
    before: "opaque-preserved-history",
    after: "changed-history",
  },
  { label: "unknown property", before: "falsey: false", after: "falsey: true" },
  { label: "Markdown body", before: "Second line.", after: "Changed line." },
  {
    label: "creation metadata",
    before: `dateCreated: '${followingDay(day, -2)}T12:00:00Z'`,
    after: `dateCreated: '${followingDay(day, -3)}T12:00:00Z'`,
  },
])("scheduling parity rejects changed $label", async ({ before, after }) => {
  await fixture(async (vault) => {
    await mutated(vault);
    await verifyParityVault(vault, day, "mutations");
    const scheduled = path.join(vault, reschedulePath);
    const source = await Bun.file(scheduled).text();
    await Bun.write(scheduled, source.replace(before, after));
    await expect(verifyParityVault(vault, day, "mutations")).rejects.toThrow();
  });
});

test("saved-view parity rejects an implicit Inbox scope", async () => {
  await fixture(async (vault) => {
    await mutated(vault, true);
    await verifyParityVault(vault, day, "controls");
    const saved = path.join(vault, "Facet/Views/parity.md");
    const source = await Bun.file(saved).text();
    await Bun.write(saved, source.replace("scope: all", "scope: inbox"));
    await expect(verifyParityVault(vault, day, "controls")).rejects.toThrow();
  });
});
