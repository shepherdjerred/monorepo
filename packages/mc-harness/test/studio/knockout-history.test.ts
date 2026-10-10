import { mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import type * as FileSystem from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterAll, describe, expect, it, vi } from "vitest";
import { clearFloorOp, flatSiteBuild } from "#test/fixtures/flat-site.ts";
import { saveCandidate } from "#build/studio/candidates.ts";
import { critiqueBuild } from "#build/studio/critique.ts";
import { knockout } from "#build/studio/knockout.ts";
import { renderBuild } from "#build/commands.ts";
import { DaemonClient } from "#build/daemon-client.ts";
import { Journal } from "#build/journal.ts";
import { writeProgramFixture } from "#test/fixtures/program-evidence.ts";
import { rubricAxisIds } from "#build/judge.ts";
import { readLog } from "#build/build-log.ts";
import { BUILD_FILES, type BuildLogEntry } from "#protocol/build.ts";
import { readJournal, trajectoryChecks } from "#evals/grade/trajectory.ts";
import { keepBuildRecord } from "#evals/lib/build-record.ts";

const boutFailure = vi.hoisted(() => ({ file: "" }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof FileSystem>();
  return {
    ...original,
    rename: async (...args: Parameters<typeof original.rename>) => {
      const from = String(args[0]);
      if (
        boutFailure.file !== "" &&
        from.includes(".bout-") &&
        from.endsWith(`/${boutFailure.file}`) &&
        ((await Bun.file(
          path.join(path.dirname(from), BUILD_FILES.journal),
        ).exists()) ||
          (await Bun.file(
            path.join(path.dirname(from), `previous-${BUILD_FILES.journal}`),
          ).exists()))
      ) {
        boutFailure.file = "";
        throw new Error("simulated bout publication failure");
      }
      return original.rename(...args);
    },
  };
});

vi.mock("@shepherdjerred/mc-build/render/assets.ts", async () => {
  const { renderAssets } = await import("#test/fixtures/render-assets.ts");
  return { ensureAssets: renderAssets };
});
const root = await mkdtemp(path.join(os.tmpdir(), "mc-knockout-history-"));
afterAll(async () => rm(root, { recursive: true }));

function judge(challengerWins = false) {
  let calls = 0;
  return vi.fn(() => {
    calls += 1;
    const first = (calls % 2 === 1) !== challengerWins;
    return Promise.resolve({
      winner: first ? ("first" as const) : ("second" as const),
      confidence: 1,
      reasons: ["fixture"],
    });
  });
}

async function saveVersion(
  workspace: Awaited<ReturnType<typeof flatSiteBuild>>,
  name: string,
  index: number,
  force = false,
) {
  await workspace.writeOplog({
    version: 1,
    ops: [clearFloorOp(index)],
  });
  await saveCandidate(workspace.dir, name, { force });
  await renderBuild(
    {
      client: new DaemonClient(),
      journal: new Journal(workspace.file("audit")),
      log: vi.fn(),
    },
    workspace.dir,
    { source: "compiled", name },
  );
  return critiqueBuild(workspace.dir, {
    render: name,
    rubric: "micro",
    model: "stub",
    stage: "visual",
    byEye: {
      axes: Object.fromEntries(rubricAxisIds("micro").map((axis) => [axis, 3])),
      overallAesthetic: 3,
      notes: [],
    },
  });
}

async function twoVersions(name: string) {
  const workspace = await flatSiteBuild(path.join(root, name), name);
  const first = await saveVersion(workspace, "v1", 1);
  const second = await saveVersion(workspace, "v2", 2);
  return { workspace, first, second };
}

describe("recoverable bout publication", () => {
  it.each(["v1", "v2"])(
    "rejects a force-saved %s during judging before publishing best or outcomes",
    async (name) => {
      const { workspace } = await twoVersions(`replaced-${name}`);
      const score = judge(true);
      let replaced = false;
      const ask = vi.fn(async () => {
        if (!replaced) {
          replaced = true;
          await workspace.writeOplog({ version: 1, ops: [clearFloorOp(3)] });
          await saveCandidate(workspace.dir, name, { force: true });
        }
        return score();
      });
      await expect(
        knockout(workspace.dir, { rubric: "micro", model: "stub", ask }),
      ).rejects.toThrow(/changed during knockout/u);
      const manifest = await workspace.manifest();
      expect(manifest.best).toBeUndefined();
      const journal = await readLog(workspace.dir);
      expect(
        journal.filter(
          (entry) => entry.kind === "accept" || entry.kind === "reject",
        ),
      ).toEqual([]);
      expect(ask).toHaveBeenCalledTimes(2);
      const retried = await knockout(workspace.dir, {
        rubric: "micro",
        model: "stub",
        ask,
      });
      expect(retried.bouts).toHaveLength(1);
      const completed = await workspace.manifest();
      expect(completed.best?.candidate).toBe(retried.best);
      expect(ask).toHaveBeenCalledTimes(4);
    },
  );

  it("keeps verdict references portable through a symlinked build directory", async () => {
    const { workspace } = await twoVersions("bout-portable");
    const alias = path.join(root, "bout-portable-alias");
    await symlink(workspace.dir, alias, "dir");
    await knockout(alias, { rubric: "micro", model: "stub", ask: judge() });
    const archive = path.join(root, "bout-portable-archive");
    await keepBuildRecord(alias, archive);
    expect(await readJournal(archive)).toHaveProperty("entries");
  });

  it("publishes a singleton acceptance and its incumbent together", async () => {
    const workspace = await flatSiteBuild(
      path.join(root, "singleton-publication"),
      "singleton-publication",
    );
    await saveVersion(workspace, "v1", 1);
    const journal = await readLog(workspace.dir);
    const options = { rubric: "micro" as const, model: "stub" };
    boutFailure.file = BUILD_FILES.manifest;
    await expect(knockout(workspace.dir, options)).rejects.toThrow(
      /publication failure/u,
    );
    const interrupted = await workspace.manifest();
    expect(interrupted.best).toBeUndefined();
    expect(await readLog(workspace.dir)).toEqual(journal);
    expect(await knockout(workspace.dir, options)).toMatchObject({
      best: "v1",
      bouts: [],
    });
    const completed = await readLog(workspace.dir);
    expect(completed.filter((entry) => entry.kind === "accept")).toHaveLength(
      1,
    );
    await workspace.writeManifest(interrupted);
    await knockout(workspace.dir, options);
    expect(await readLog(workspace.dir)).toEqual(completed);
  });

  it.each([BUILD_FILES.journal, BUILD_FILES.manifest])(
    "reuses the paid verdict after %s publication fails",
    async (file) => {
      const { workspace } = await twoVersions(
        `bout-failure-${file.replaceAll(".", "-")}`,
      );
      const journal = await readLog(workspace.dir);
      const ask = judge(true);
      boutFailure.file = file;
      await expect(
        knockout(workspace.dir, { rubric: "micro", model: "stub", ask }),
      ).rejects.toThrow(/bout publication failure/u);
      expect(ask).toHaveBeenCalledTimes(2);
      expect(await readLog(workspace.dir)).toEqual(journal);
      const interrupted = await workspace.manifest();
      expect(interrupted.best).toBeUndefined();
      const retryAsk = vi.fn(() =>
        Promise.reject(new Error("must reuse persisted verdict")),
      );
      const retried = await knockout(workspace.dir, {
        rubric: "micro",
        model: "stub",
        ask: retryAsk,
      });
      expect(retried.best).toBe("v2");
      expect(retryAsk).not.toHaveBeenCalled();
      const completedJournal = await readLog(workspace.dir);
      const outcomes = completedJournal.filter(
        (entry) => entry.kind === "accept" || entry.kind === "reject",
      );
      expect(outcomes.map((entry) => [entry.kind, entry.candidate])).toEqual([
        ["accept", "v2"],
        ["reject", "v1"],
      ]);
      const completed = await workspace.manifest();
      expect(completed.knockout).toBeUndefined();
    },
  );

  it("deduplicates persisted outcomes when an explicit checkpoint lags after process exit", async () => {
    const { workspace } = await twoVersions("bout-crash-recovery");
    let checkpoint = await workspace.manifest();
    const askJudge = judge(true);
    const ask = vi.fn(async () => {
      checkpoint = await workspace.manifest();
      return askJudge();
    });
    const options = {
      among: ["v1", "v2"],
      rubric: "micro" as const,
      model: "stub",
    };
    await knockout(workspace.dir, { ...options, ask });
    const journal = await readLog(workspace.dir);
    await workspace.writeManifest(checkpoint);
    // The cached verdict also needs no provider credentials on retry.
    const result = await knockout(workspace.dir, options);
    expect(result.best).toBe("v2");
    expect(await readLog(workspace.dir)).toEqual(journal);
    const completed = await workspace.manifest();
    expect(completed.knockout).toBeUndefined();
  });

  it("rejects a damaged durable verdict before another judge call", async () => {
    const { workspace } = await twoVersions("bout-damaged-verdict");
    const options = { rubric: "micro" as const, model: "stub" };
    boutFailure.file = BUILD_FILES.journal;
    await expect(
      knockout(workspace.dir, { ...options, ask: judge() }),
    ).rejects.toThrow(/publication failure/u);
    const files = await readdir(workspace.file(BUILD_FILES.judgeDir));
    const verdict = files.find((file) => file.startsWith("pair-bout-"));
    if (verdict === undefined) throw new Error("missing durable verdict");
    await Bun.write(
      workspace.file(path.join(BUILD_FILES.judgeDir, verdict)),
      "truncated",
    );
    const ask = judge();
    await expect(
      knockout(workspace.dir, { ...options, ask }),
    ).rejects.toThrow();
    expect(ask).not.toHaveBeenCalled();
  });
});

describe("winning-grid aliases", () => {
  it("prefers the incumbent alias and requires a bout for a genuinely new grid", async () => {
    const { workspace } = await twoVersions("winner-alias");
    const ask = judge();
    const options = { rubric: "micro" as const, model: "stub", ask };
    await knockout(workspace.dir, options);
    await saveVersion(workspace, "alias", 1);
    const repeated = await knockout(workspace.dir, options);
    expect(repeated.best).toBe("v1");
    expect(repeated.bouts).toEqual([]);
    expect(ask).toHaveBeenCalledTimes(2);
    await knockout(workspace.dir, {
      ...options,
      among: ["v1", "alias"],
      ask: judge(true),
    });
    const preferred = await knockout(workspace.dir, options);
    expect(preferred.best).toBe("alias");
    expect(preferred.bouts).toEqual([]);
    expect(ask).toHaveBeenCalledTimes(2);
    await saveVersion(workspace, "v3", 3);
    const changed = await knockout(workspace.dir, options);
    expect(
      changed.bouts.map((bout) => [bout.incumbent, bout.challenger]),
    ).toEqual([["alias", "v3"]]);
    expect(ask).toHaveBeenCalledTimes(4);
  });
});

describe("distinct critiqued builds", () => {
  it("cannot replace the incumbent by deleting its saved directory first", async () => {
    const { workspace } = await twoVersions("missing-incumbent");
    await knockout(workspace.dir, {
      rubric: "micro",
      model: "stub",
      ask: judge(),
    });
    await rm(workspace.file("candidates/v1"), { recursive: true });
    const before = await readLog(workspace.dir);
    await expect(
      saveCandidate(workspace.dir, "v1", { force: true }),
    ).rejects.toThrow(/incumbent/u);
    expect(await readLog(workspace.dir)).toEqual(before);
    expect(
      await Bun.file(workspace.file("candidates/v1/candidate.json")).exists(),
    ).toBe(false);
  });

  it("does not reseed a grid eliminated by this model after another model restores it", async () => {
    const { workspace } = await twoVersions("policy-incumbent");
    await knockout(workspace.dir, {
      rubric: "micro",
      model: "stub",
      ask: judge(),
    });
    await knockout(workspace.dir, {
      rubric: "micro",
      model: "other",
      ask: judge(true),
    });
    const ask = judge();
    const repeated = await knockout(workspace.dir, {
      rubric: "micro",
      model: "stub",
      ask,
    });
    expect(repeated.best).toBe("v1");
    expect(repeated.bouts).toEqual([]);
    expect(ask).not.toHaveBeenCalled();
  });

  it("preserves the first publication when two unforced saves race for a name", async () => {
    const workspace = await flatSiteBuild(
      path.join(root, "save-race"),
      "save-race",
    );
    await workspace.writeOplog({ version: 1, ops: [clearFloorOp(1)] });
    const outcomes = await Promise.allSettled([
      saveCandidate(workspace.dir, "saved"),
      saveCandidate(workspace.dir, "saved"),
    ]);
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(outcomes.filter((item) => item.status === "rejected")).toHaveLength(
      1,
    );
    const entries = await readLog(workspace.dir);
    expect(entries.filter((entry) => entry.kind === "candidate")).toHaveLength(
      1,
    );
    expect(await readdir(workspace.file("candidates/saved"))).toContain(
      "candidate.json",
    );
  });

  it("retains elimination evidence when a rejected grid is saved under a new name", async () => {
    const { workspace } = await twoVersions("eliminated-alias");
    const ask = judge();
    const options = { rubric: "micro" as const, model: "stub", ask };
    await knockout(workspace.dir, options);
    await saveVersion(workspace, "alias", 2);
    const repeated = await knockout(workspace.dir, options);
    expect(repeated.bouts).toEqual([]);
    expect(ask).toHaveBeenCalledTimes(2);
    const rematch = await knockout(workspace.dir, {
      ...options,
      among: ["v1", "alias"],
    });
    expect(rematch.bouts).toHaveLength(1);
    expect(ask).toHaveBeenCalledTimes(4);
  });

  it.each(["missing", "invalid"])(
    "preserves candidate artifacts with %s metadata on save and forced save",
    async (failure) => {
      const { workspace } = await twoVersions(`damaged-save-${failure}`);
      const dir = workspace.file("candidates/v2");
      const info = path.join(dir, "candidate.json");
      if (failure === "missing") await rm(info);
      else await Bun.write(info, "{}");
      const names = await readdir(dir);
      const bytes = await Promise.all(
        names.map((name) => Bun.file(path.join(dir, name)).bytes()),
      );
      const entries = await readLog(workspace.dir);
      for (const force of [false, true]) {
        await expect(
          saveCandidate(workspace.dir, "v2", { force }),
        ).rejects.toThrow();
        expect(await readdir(dir)).toEqual(names);
        expect(
          await Promise.all(
            names.map((name) => Bun.file(path.join(dir, name)).bytes()),
          ),
        ).toEqual(bytes);
        expect(await readLog(workspace.dir)).toEqual(entries);
      }
    },
  );

  it("counts changed grids rather than renamed renders of an unchanged build", async () => {
    const workspace = await flatSiteBuild(
      path.join(root, "distinct-grids"),
      "distinct-grids",
    );
    await saveVersion(workspace, "v1", 1);
    await saveVersion(workspace, "v2", 1);
    const unchanged = await readJournal(workspace.dir);
    expect(unchanged).toHaveProperty("entries");
    expect(trajectoryChecks(unchanged, "micro")[1]?.pass).toBe(false);
    await saveVersion(workspace, "v3", 2);
    const changed = await readJournal(workspace.dir);
    expect(changed).toHaveProperty("entries");
    expect(trajectoryChecks(changed, "micro")[1]?.pass).toBe(true);
  });
});

describe("default knockout iteration", () => {
  it("requires a new visual critique when a render name is reused", async () => {
    const workspace = await flatSiteBuild(
      path.join(root, "render-reused"),
      "render-reused",
    );
    await workspace.writeOplog({
      version: 1,
      ops: [{ ...clearFloorOp(1), source: "program:abcd" }],
    });
    await writeProgramFixture(workspace, "abcd", "// fixture program\n");
    const env = {
      client: new DaemonClient(),
      journal: new Journal(workspace.file("audit")),
      log: vi.fn(),
    };
    await renderBuild(env, workspace.dir, { source: "compiled", name: "v1" });
    await critiqueBuild(workspace.dir, {
      render: "v1",
      rubric: "micro",
      model: "stub",
      stage: "visual",
      byEye: {
        axes: Object.fromEntries(
          rubricAxisIds("micro").map((axis) => [axis, 3]),
        ),
        overallAesthetic: 3,
        notes: [],
      },
    });
    await renderBuild(
      {
        client: new DaemonClient(),
        journal: new Journal(workspace.file("audit")),
        log: vi.fn(),
      },
      workspace.dir,
      { source: "compiled", name: "v1" },
    );
    const askCode = vi.fn(() => Promise.resolve({ suggestions: [] }));
    await expect(
      critiqueBuild(workspace.dir, {
        render: "v1",
        rubric: "micro",
        model: "stub",
        stage: "code",
        askCode,
      }),
    ).rejects.toThrow(/no visual critique/u);
    expect(askCode).not.toHaveBeenCalled();
  });

  it("judges only new candidates and reuses completed decisions", async () => {
    const { workspace } = await twoVersions("incremental");
    const ask = judge();
    const options = { rubric: "micro" as const, model: "stub", ask };
    const initial = await knockout(workspace.dir, options);
    expect(initial.bouts).toHaveLength(1);
    await saveVersion(workspace, "v3", 3);
    const next = await knockout(workspace.dir, options);
    expect(next.bouts.map((bout) => bout.challenger)).toEqual(["v3"]);
    expect(ask).toHaveBeenCalledTimes(4);
    const repeated = await knockout(workspace.dir, {
      rubric: "micro",
      model: "stub",
    });
    expect(repeated.bouts).toEqual([]);
    expect(ask).toHaveBeenCalledTimes(4);
    expect(await readJournal(workspace.dir)).toHaveProperty("entries");
  });

  it("rejudges replaced grids and explicit rematches", async () => {
    const { workspace } = await twoVersions("replaced");
    const ask = judge();
    const options = { rubric: "micro" as const, model: "stub", ask };
    await knockout(workspace.dir, options);
    await saveVersion(workspace, "v2", 4, true);
    const replaced = await knockout(workspace.dir, options);
    expect(replaced.bouts).toHaveLength(1);
    const rematch = await knockout(workspace.dir, {
      ...options,
      among: ["v1", "v2"],
    });
    expect(rematch.bouts).toHaveLength(1);
    expect(ask).toHaveBeenCalledTimes(6);
  });

  it("retains a restored winner and scopes decisions to the judging model", async () => {
    const { workspace } = await twoVersions("restored");
    await knockout(workspace.dir, {
      rubric: "micro",
      model: "stub",
      ask: judge(),
    });
    const restored = await knockout(workspace.dir, {
      rubric: "micro",
      model: "stub",
      among: ["v1", "v2"],
      ask: judge(true),
    });
    expect(restored.best).toBe("v2");
    await saveVersion(workspace, "v3", 3);
    const next = await knockout(workspace.dir, {
      rubric: "micro",
      model: "stub",
      ask: judge(),
    });
    expect(next.bouts.map((bout) => [bout.incumbent, bout.challenger])).toEqual(
      [["v2", "v3"]],
    );
    const differentModel = await knockout(workspace.dir, {
      rubric: "micro",
      model: "other",
      ask: judge(),
    });
    expect(differentModel.bouts).toHaveLength(2);
    const differentRubric = await knockout(workspace.dir, {
      rubric: "map",
      model: "stub",
      ask: judge(),
    });
    expect(differentRubric.bouts).toHaveLength(2);
  });

  it("resumes a partial default pool without rejudging its eliminated grid", async () => {
    const { workspace } = await twoVersions("interrupted");
    await saveVersion(workspace, "v3", 3);
    const keep = judge();
    let calls = 0;
    const ask = vi.fn(() => {
      calls += 1;
      return calls > 2 ? Promise.reject(new Error("interrupted")) : keep();
    });
    await expect(
      knockout(workspace.dir, { rubric: "micro", model: "stub", ask }),
    ).rejects.toThrow("interrupted");
    const resumed = await knockout(workspace.dir, {
      rubric: "micro",
      model: "stub",
      ask: judge(),
    });
    expect(resumed.bouts.map((bout) => bout.challenger)).toEqual(["v3"]);
  });
});

describe("outcome score evidence", () => {
  it.each(["accept", "reject"] as const)(
    "requires a pair verdict for a scored %s outcome",
    async (kind) => {
      const { workspace } = await twoVersions(`null-pair-${kind}`);
      await knockout(workspace.dir, {
        rubric: "micro",
        model: "stub",
        ask: judge(),
      });
      const entries = await readLog(workspace.dir);
      const outcome = entries.find((entry) => entry.kind === kind);
      if (outcome === undefined) throw new Error("missing paired outcome");
      await Bun.write(
        workspace.file(BUILD_FILES.journal),
        entries
          .map((entry) =>
            JSON.stringify(
              entry === outcome ? { ...entry, file: null } : entry,
            ),
          )
          .join("\n"),
      );
      expect(await readJournal(workspace.dir)).toHaveProperty("error");
      const ask = judge();
      await expect(
        knockout(workspace.dir, { rubric: "micro", model: "stub", ask }),
      ).rejects.toThrow(/verdict file/u);
      expect(ask).not.toHaveBeenCalled();
    },
  );

  it.each(["score", "grid", "critique", "rubric", "copied", "legacy"])(
    "rejects %s corruption before grading or more judging",
    async (failure) => {
      const { workspace, second } = await twoVersions(`score-${failure}`);
      await knockout(workspace.dir, {
        rubric: "micro",
        model: "stub",
        ask: judge(),
      });
      const entries = await readLog(workspace.dir);
      const accepted = entries.find((entry) => entry.kind === "accept");
      const other = entries.find(
        (entry) => entry.kind === "critique" && entry.file === second.record,
      );
      if (accepted?.kind !== "accept" || other?.kind !== "critique")
        throw new Error("missing evidence fixture");
      let altered: BuildLogEntry = accepted;
      switch (failure) {
        case "score":
          altered = { ...accepted, score: (accepted.score ?? 0) + 1 };
          break;
        case "grid":
          altered = { ...accepted, gridHash: other.gridHash };
          break;
        case "critique":
          altered = { ...accepted, critique: other.file };
          break;
        case "rubric":
          altered = { ...accepted, rubric: "map" };
          break;
        case "copied":
          altered = {
            ...accepted,
            gridHash: other.gridHash,
            critique: other.file,
            score: other.total,
          };
          break;
        case "legacy": {
          const {
            gridHash: _gridHash,
            critique: _critique,
            ...legacy
          } = accepted;
          altered = legacy;
          break;
        }
        default:
          throw new Error("unknown fixture");
      }
      await Bun.write(
        workspace.file(BUILD_FILES.journal),
        entries
          .map((entry) => JSON.stringify(entry === accepted ? altered : entry))
          .join("\n"),
      );
      const journal = await readJournal(workspace.dir);
      expect(journal).toHaveProperty("error");
      expect(
        trajectoryChecks(journal, "micro").every((check) => !check.pass),
      ).toBe(true);
      const ask = judge();
      await expect(
        knockout(workspace.dir, { rubric: "micro", model: "stub", ask }),
      ).rejects.toThrow();
      expect(ask).not.toHaveBeenCalled();
    },
  );

  it("binds a singleton acceptance and preserves critique checksums through archival", async () => {
    const workspace = await flatSiteBuild(
      path.join(root, "singleton"),
      "singleton",
    );
    const critique = await saveVersion(workspace, "v1", 1);
    await knockout(workspace.dir, {
      rubric: "micro",
      model: "stub",
      ask: judge(),
    });
    expect(await readJournal(workspace.dir)).toHaveProperty("entries");
    const archive = path.join(root, "archive");
    await keepBuildRecord(workspace.dir, archive);
    expect(await readJournal(archive)).toHaveProperty("entries");
    await Bun.write(workspace.file(critique.sheet), "truncated PNG");
    await expect(
      keepBuildRecord(workspace.dir, path.join(root, "bad-archive")),
    ).rejects.toThrow(/hash/u);
    expect(await readJournal(workspace.dir)).toHaveProperty("error");
    expect(await readJournal(archive)).toHaveProperty("entries");
  });
});
