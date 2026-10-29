import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  FORUM_RELEASE_STEPS,
  forumResumeStep,
  runForumReleaseSteps,
  reuseCompletedForumRelease,
  writeForumReleaseJournal,
  acknowledgeForumReleaseStep,
  type ForumReleaseJournal,
} from "#src/release-journal.ts";

function journal(): ForumReleaseJournal {
  return {
    schema: "storm-forum-release/v1",
    stage: "prod",
    owner: crypto.randomUUID(),
    candidate: {
      runtimeImage: `docker.io/shepherdjerred/storm-forum@sha256:${"a".repeat(64)}`,
      bundleSha256: "b".repeat(64),
      xenforoVersion: "2.3.10",
    },
    original: null,
    installationObserved: true,
    originalSnapshot: null,
    phase: "ready",
    step: null,
    completed: [],
  };
}

describe("operator acknowledgement of a completed interrupted Forum step", () => {
  it.each(["install", "addons", "seed", "history", "accounts"] as const)(
    "acknowledges only independently completed %s, preserving the original identity and never replaying it",
    async (step) => {
      const directory = await mkdtemp(path.join(tmpdir(), "forum-ack-"));
      try {
        const value = journal();
        value.phase = "mutating";
        value.step = step;
        value.completed = FORUM_RELEASE_STEPS.slice(
          0,
          FORUM_RELEASE_STEPS.indexOf(step),
        );
        value.original = value.candidate;
        value.originalSnapshot = `snapshots/prod/${value.owner}/manifest.json`;
        const file = path.join(directory, "journal.json");
        await writeForumReleaseJournal(file, value);
        const before = await Bun.file(file).text();
        const input = {
          step,
          journalSha256: createHash("sha256").update(before).digest("hex"),
        };
        await expect(
          acknowledgeForumReleaseStep(
            file,
            value,
            { ...input, journalSha256: "0".repeat(64) },
            async () => {
              throw new Error("must not inspect stale journal");
            },
          ),
        ).rejects.toThrow("bytes or identity");
        await expect(
          acknowledgeForumReleaseStep(file, value, input, async () => {
            throw new Error("native migration is incomplete");
          }),
        ).rejects.toThrow("incomplete");
        expect(await Bun.file(file).text()).toBe(before);
        const verified: string[] = [];
        await acknowledgeForumReleaseStep(
          file,
          value,
          input,
          async (checked) => {
            verified.push(checked);
          },
        );
        expect(verified).toEqual([step]);
        expect(value.completed).toEqual(
          FORUM_RELEASE_STEPS.slice(0, FORUM_RELEASE_STEPS.indexOf(step) + 1),
        );
        expect(value).toMatchObject({
          owner: JSON.parse(before).owner,
          originalSnapshot: JSON.parse(before).originalSnapshot,
          phase: "ready",
          step: null,
        });
        const effects: string[] = [];
        await runForumReleaseSteps(
          value,
          async (next) => {
            effects.push(next);
          },
          () => Promise.resolve(),
        );
        expect(effects).toEqual(
          FORUM_RELEASE_STEPS.slice(FORUM_RELEASE_STEPS.indexOf(step) + 1),
        );
        expect(effects).not.toContain(step);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
  it("refuses a different interrupted step and a journal changed during readonly inspection", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "forum-ack-race-"));
    try {
      const value = journal();
      value.phase = "mutating";
      value.step = "install";
      const file = path.join(directory, "journal.json");
      await writeForumReleaseJournal(file, value);
      const before = await Bun.file(file).text();
      const journalSha256 = createHash("sha256").update(before).digest("hex");
      await expect(
        acknowledgeForumReleaseStep(
          file,
          value,
          { step: "addons", journalSha256 },
          async () => {
            throw new Error("must not inspect foreign step");
          },
        ),
      ).rejects.toThrow("exact interrupted step");
      await expect(
        acknowledgeForumReleaseStep(
          file,
          value,
          { step: "install", journalSha256 },
          async () => {
            await Bun.write(file, before + "\n");
          },
        ),
      ).rejects.toThrow("changed during");
      expect(value.phase).toBe("mutating");
      expect(value.completed).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("original Forum native phase journal", () => {
  it("recreated completed Job verifies the same candidate without changing owner, journal or replaying steps", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "forum-complete-"));
    try {
      const value = journal();
      value.phase = "complete";
      value.completed = [...FORUM_RELEASE_STEPS];
      const file = path.join(directory, "journal.json"),
        marker = path.join(directory, "maintenance");
      await writeForumReleaseJournal(file, value);
      const before = await Bun.file(file).text();
      let verified = 0;
      const effects = {
        unlocked: async () => !(await Bun.file(marker).exists()),
        verify: () => {
          verified++;
          return Promise.resolve();
        },
      };
      expect(
        await reuseCompletedForumRelease(
          { journal: value, candidate: value.candidate, stage: value.stage },
          effects,
        ),
      ).toBe(true);
      expect(verified).toBe(1);
      expect(await Bun.file(file).text()).toBe(before);
      await Bun.write(marker, value.owner);
      await expect(
        reuseCompletedForumRelease(
          { journal: value, candidate: value.candidate, stage: value.stage },
          effects,
        ),
      ).rejects.toThrow("ownership markers");
      await expect(
        reuseCompletedForumRelease(
          {
            journal: value,
            candidate: { ...value.candidate, bundleSha256: "d".repeat(64) },
            stage: value.stage,
          },
          effects,
        ),
      ).rejects.toThrow("another candidate");
      await expect(
        reuseCompletedForumRelease(
          {
            journal: { ...value, completed: [] },
            candidate: value.candidate,
            stage: value.stage,
          },
          effects,
        ),
      ).rejects.toThrow("every completed");
      expect(verified).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("checkpoints before effects and resumes a failed idempotent step without replaying migrations", async () => {
    const value = journal();
    const events: string[] = [];
    await expect(
      runForumReleaseSteps(
        value,
        async (step) => {
          events.push(`effect:${step}`);
          if (step === "configure")
            throw new Error("transient database connection");
        },
        async (checkpoint) => {
          events.push(
            `checkpoint:${checkpoint.phase}:${checkpoint.step ?? "none"}`,
          );
        },
      ),
    ).rejects.toThrow("transient");
    expect(events.indexOf("checkpoint:mutating:install")).toBeLessThan(
      events.indexOf("effect:install"),
    );
    expect(value.completed).toEqual(["install", "addons"]);
    const resumed: string[] = [];
    await runForumReleaseSteps(
      value,
      async (step) => {
        resumed.push(step);
      },
      () => Promise.resolve(),
    );
    expect(resumed).toEqual(FORUM_RELEASE_STEPS.slice(2));
    expect(value.completed).toEqual(FORUM_RELEASE_STEPS);
  });

  it.each(["install", "addons", "seed", "history", "accounts"] as const)(
    "refuses uncertain interrupted %s for reviewed native repair",
    (step) => {
      const value = journal();
      value.phase = "mutating";
      value.step = step;
      value.completed = FORUM_RELEASE_STEPS.slice(
        0,
        FORUM_RELEASE_STEPS.indexOf(step),
      );
      expect(() => forumResumeStep(value)).toThrow("partially mutated");
    },
  );

  it("requires original installation observation and an exact prefix", () => {
    const value = journal();
    value.installationObserved = false;
    expect(() => forumResumeStep(value)).toThrow("independently observed");
    value.installationObserved = true;
    value.completed = ["addons"];
    expect(() => forumResumeStep(value)).toThrow("ordered prefix");
    value.completed = [];
    // A legacy journal that recorded an original without a snapshot still resumes.
    value.original = value.candidate;
    expect(forumResumeStep(value)).toBe(0);
  });

  it("permits verified cleanup without rerunning native commands and rejects incomplete verification", () => {
    const value = journal();
    value.phase = "verified";
    expect(() => forumResumeStep(value)).toThrow("every completed");
    value.completed = [...FORUM_RELEASE_STEPS];
    expect(forumResumeStep(value)).toBe(FORUM_RELEASE_STEPS.length);
    value.phase = "complete";
    expect(forumResumeStep(value)).toBe(FORUM_RELEASE_STEPS.length);
  });

  it("never replaces original owner, recorded original, candidate or completed checkpoints", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "forum-journal-"));
    try {
      const file = path.join(directory, "journal.json");
      const value = journal();
      value.original = value.candidate;
      value.originalSnapshot = `snapshots/prod/${value.owner}/manifest.json`;
      value.completed = ["install"];
      await writeForumReleaseJournal(file, value);
      await expect(
        writeForumReleaseJournal(file, {
          ...value,
          owner: crypto.randomUUID(),
        }),
      ).rejects.toThrow("original owner");
      await expect(
        writeForumReleaseJournal(file, {
          ...value,
          originalSnapshot: "other/manifest.json",
        }),
      ).rejects.toThrow("recorded original");
      await expect(
        writeForumReleaseJournal(file, { ...value, completed: [] }),
      ).rejects.toThrow("discard");
      expect(await Bun.file(file).json()).toEqual(value);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
