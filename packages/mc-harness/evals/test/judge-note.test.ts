import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AskJudge } from "#build/judge.ts";
import { judgeNote } from "#evals/grade/judge-note.ts";

/** Prefers whichever image starts with byte `prefer`, in either order. */
const stubJudge =
  (prefer: number): AskJudge =>
  (first) =>
    Promise.resolve({
      winner: first.data[0] === prefer ? "first" : "second",
      confidence: 0.7,
      reasons: ["stub"],
    });

async function pngs(): Promise<{ agent: string; reference: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "judge-note-"));
  const agent = path.join(dir, "agent.png");
  const reference = path.join(dir, "reference.png");
  await writeFile(agent, new Uint8Array([1]));
  await writeFile(reference, new Uint8Array([2]));
  return { agent, reference };
}

describe("judgeNote", () => {
  it("reports the agreed winner with the judge's reasons", async () => {
    const { agent, reference } = await pngs();
    const rubrics: string[] = [];
    const { note, verdict } = await judgeNote({
      render: agent,
      reference: { slug: "cottage", render: reference },
      model: "stub-model",
      rubric: "map",
      makeAsk: (_model, rubric) => {
        rubrics.push(rubric);
        return stubJudge(1);
      },
    });
    expect(rubrics).toEqual(["map"]);
    expect(note).toBe(
      "judge vs library/cottage (stub-model): agent build wins, confidence 0.70; (a first) stub / (b first) stub",
    );
    expect(verdict?.winner).toBe("a");
  });

  it("skips with the reason when no judge can be built", async () => {
    const { agent, reference } = await pngs();
    const { note, verdict } = await judgeNote({
      render: agent,
      reference: { slug: "cottage", render: reference },
      makeAsk: () => {
        throw new Error("no anthropic credentials are configured");
      },
    });
    expect(note).toBe("judge skipped: no anthropic credentials are configured");
    expect(verdict).toBeNull();
  });
});
