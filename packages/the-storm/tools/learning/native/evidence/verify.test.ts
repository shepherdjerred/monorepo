import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, expect, it } from "vitest";
import { z } from "zod";
import { regressionFixture } from "#learning/promotion/test-support/regression-fixture.ts";
import { Snapshot } from "#learning/promotion/archive.ts";
import { nativeFingerprint } from "#learning/preference/eligibility.ts";
import {
  digestFile,
  jsonText,
  sha,
  readJson,
} from "#learning/preference/ledger.ts";
import { RegressionCommand } from "#learning/native/regression-gate.ts";
import { querySqlite } from "#e2e/harness/storm-data.ts";
import type { Suite, Case } from "./wire.ts";
import { originalSuite } from "./verify.ts";

let directory = "",
  file = "";
let suite: Suite;
beforeEach(async () => {
  directory = await mkdtemp(
    path.join(os.tmpdir(), "rwf-original-regression-suite-"),
  );
  const nativeFile = path.join(directory, "native.fixture");
  await writeFile(nativeFile, "synthetic native boundary only");
  const native = {
    hashes: [{ file: nativeFile, sha256: await digestFile(nativeFile) }],
    engine: "Paper",
    controllerHz: 20,
    timeoutTicks: 1200,
    runtime: { synthetic: "codec only" },
  };
  const fixture = await regressionFixture(
    path.join(directory, "originals"),
    native,
    sha("synthetic actor"),
    sha("synthetic manifest"),
  );
  file = fixture.file;
  suite = fixture.suite;
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
const candidate = () => ({
  actor_sha256: suite.inputs.capture.artifacts.actor,
  source_manifest_sha256: suite.inputs.capture.artifacts.manifest,
  native_sha256: nativeFingerprint(suite.inputs.capture.native),
});
const verify = () => originalSuite(new Snapshot(), file, candidate());
const save = () => writeFile(file, jsonText(suite));
function binding(name: string): Case {
  const row = suite.cases.find((test) => test.name === name);
  if (row === undefined) throw new Error("Synthetic case missing");
  return row;
}
async function alter(
  name: string,
  edit: (row: Case, receipt: Record<string, unknown>) => Promise<void>,
) {
  const row = binding(name),
    target = path.join(row.directory, "verification.json");
  const receipt = z
    .record(z.string(), z.unknown())
    .parse(await readJson(target));
  await edit(row, receipt);
  await writeFile(target, jsonText(receipt));
  row.receipt_sha256 = await digestFile(target);
  await save();
}

it("replays all seven original-format cases and snapshots raw sources without accepting a model", async () => {
  const snapshot = new Snapshot();
  expect(await originalSuite(snapshot, file, candidate())).toEqual(
    suite.measured,
  );
  const files = snapshot.files().map((row) => row.file);
  expect(
    files.filter(
      (name) =>
        name.endsWith("commands.jsonl") &&
        !name.endsWith("native-commands.jsonl"),
    ),
  ).toHaveLength(6);
  expect(files.filter((name) => name.endsWith(".rwfrec.gz"))).toHaveLength(6);
  expect(files).toContain(
    path.join(binding("last-human-abort").directory, "database/the-storm.db"),
  );
  expect(files).toContain(
    path.join(binding("simulation-floors").directory, "simulation.jsonl"),
  );
  expect(suite.modelAccepted).toBe(false);
  await snapshot.verify();
});
it("aggregate pass claims cannot substitute for an original suite", async () => {
  await writeFile(file, jsonText(suite.measured));
  await expect(verify()).rejects.toThrow();
});
it.each(["actor", "manifest", "runtime"])(
  "rejects a different candidate %s",
  async (kind) => {
    const different = candidate();
    if (kind === "actor") different.actor_sha256 = sha("different actor");
    if (kind === "manifest")
      different.source_manifest_sha256 = sha("different manifest");
    if (kind === "runtime") different.native_sha256 = sha("different runtime");
    await expect(
      originalSuite(new Snapshot(), file, different),
    ).rejects.toThrow("differs from candidate");
  },
);
it.each(["missing", "reordered", "reused"])(
  "rejects %s original case ownership",
  async (kind) => {
    if (kind === "missing") suite.cases.pop();
    const first = suite.cases[0],
      second = suite.cases[1];
    if (first === undefined || second === undefined)
      throw new Error("Synthetic case inventory missing");
    if (kind === "reordered") {
      suite.cases[0] = second;
      suite.cases[1] = first;
    }
    if (kind === "reused") second.directory = first.directory;
    await save();
    await expect(verify()).rejects.toThrow();
  },
);
it("valid but inflated floor claims still differ from the original measurements", async () => {
  suite.measured.native_floors.minimum_spacing += 1;
  await save();
  await expect(verify()).rejects.toThrow("claims differ from original replay");
});
it("changed recording bytes cannot be hidden behind unchanged pass receipts", async () => {
  const row = binding("native-team-advancement");
  const receipt = z
    .object({ original_recording: z.object({ file: z.string() }) })
    .parse(await readJson(path.join(row.directory, "verification.json")));
  await writeFile(
    receipt.original_recording.file,
    "changed original recording",
  );
  await expect(verify()).rejects.toThrow("evidence changed");
});
it("redigesting a native journal still cannot hide missing original damage rows", async () => {
  await alter("human-combat", async (row, receipt) => {
    const target = path.join(row.directory, "commands.jsonl");
    const text = await Bun.file(target).text();
    const rows = z.array(RegressionCommand).parse(
      text
        .trim()
        .split("\n")
        .map((line): unknown => JSON.parse(line)),
    );
    rows.forEach((command) => {
      command.state.damage = [];
    });
    await writeFile(
      target,
      rows.map((command) => JSON.stringify(command)).join("\n") + "\n",
    );
    receipt["commands_sha256"] = await digestFile(target);
  });
  await expect(verify()).rejects.toThrow();
});
it("redigesting simulation data still cannot conceal missing original ticks", async () => {
  await alter("simulation-floors", async (row, receipt) => {
    const target = path.join(row.directory, "simulation.jsonl");
    const text = await Bun.file(target).text();
    const lines = text.trim().split("\n");
    lines.splice(5, 1);
    await writeFile(target, lines.join("\n") + "\n");
    receipt["journal_sha256"] = await digestFile(target);
  });
  await expect(verify()).rejects.toThrow("original ticks");
});
it("checks saved zero-credit settlement rows against the actual database", async () => {
  await alter("last-human-abort", async (row, receipt) => {
    const target = path.join(row.directory, "settlement.json");
    const settlement = z
      .object({ database: z.string(), sha256: z.string(), rows: z.unknown() })
      .parse(await readJson(target));
    await querySqlite(
      settlement.database,
      "UPDATE rwf_match_player SET credits_owed = 1",
    );
    settlement.sha256 = await digestFile(settlement.database);
    await writeFile(target, jsonText(settlement));
    receipt["settlement_sha256"] = await digestFile(target);
  });
  await expect(verify()).rejects.toThrow();
});
it("checks healing personalities against their authored frozen content", async () => {
  await alter("healing-and-lifecycle", async (row, receipt) => {
    const target = path.join(row.directory, "healing.json");
    const identity = z
      .object({
        personalities: z.array(z.object({ name: z.string() }).loose()),
      })
      .loose()
      .parse(await readJson(target));
    const first = identity.personalities[0];
    if (first === undefined) throw new Error("Synthetic personality missing");
    first.name = "Invented";
    await writeFile(target, jsonText(identity));
    receipt["healing_sha256"] = await digestFile(target);
  });
  await expect(verify()).rejects.toThrow(
    "original authored personality content",
  );
});
it("detects new compiled runtime files outside the original inventory", async () => {
  const folder = suite.inputs.simulation.classpath[0];
  if (folder === undefined) throw new Error("Synthetic runtime missing");
  await writeFile(
    path.join(folder, "Extra.class"),
    "unexpected compiled input",
  );
  await expect(verify()).rejects.toThrow("runtime inventory changed");
});
it("failed attempts remain ineligible even when they contain pass-shaped receipts", async () => {
  await writeFile(
    path.join(binding("human-combat").directory, "failure.json"),
    jsonText({ error: "retained failure" }),
  );
  await expect(verify()).rejects.toThrow("Failed original regression attempts");
});
it("a changed original receipt is caught before its claims are replayed", async () => {
  await writeFile(
    path.join(
      binding("native-los-and-knockback").directory,
      "verification.json",
    ),
    "{}",
  );
  await expect(verify()).rejects.toThrow("evidence changed");
});
it("Java aggregates remain bound to the original replay after their hashes are refreshed", async () => {
  const target = path.join(path.dirname(file), "measured-regressions.json");
  const changed = {
    ...suite.measured,
    native_floors: {
      ...suite.measured.native_floors,
      minimum_spacing: suite.measured.native_floors.minimum_spacing + 1,
    },
  };
  await writeFile(target, jsonText(changed));
  suite.measured_sha256 = await digestFile(target);
  await save();
  await expect(verify()).rejects.toThrow(
    "Java regression aggregates differ from original replay",
  );
});
it("the suite keeps the initial input declaration sealed across all cases", async () => {
  await writeFile(
    path.join(path.dirname(file), "inputs.json"),
    jsonText({
      schema: 1,
      acceptance: "unaccepted",
      diagnostic: true,
      retries: 0,
      inputs: {
        ...suite.inputs,
        capture: {
          ...suite.inputs.capture,
          artifacts: {
            ...suite.inputs.capture.artifacts,
            actor: sha("edited declaration"),
          },
        },
      },
    }),
  );
  await expect(verify()).rejects.toThrow(
    "Original suite input declaration changed",
  );
});
