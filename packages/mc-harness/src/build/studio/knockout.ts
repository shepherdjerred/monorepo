/**
 * `build candidate knockout`: the incumbent (`manifest.best`) meets each
 * challenger in an order-swapped pairwise judgment on anonymised judge
 * sheets; a challenger has to win outright to take the title, a tie keeps
 * the incumbent. Every verdict is written under `judge/` and the journal
 * gets an accept and a reject per bout, so the build's record shows which
 * versions were kept and why.
 */
import path from "node:path";
import { createHash } from "node:crypto";
import { ensureAssets } from "@shepherdjerred/mc-build/render/assets.ts";
import {
  assertTexturesPresent,
  encodePng,
  Renderer,
} from "@shepherdjerred/mc-build/render/index.ts";
import type { BuildManifest, JudgeRubric } from "#protocol/build.ts";
import { appendLog } from "#build/build-log.ts";
import {
  candidateGrid,
  candidateScore,
  listCandidates,
  readCandidate,
} from "./candidates.ts";
import {
  judgeFingerprint,
  judgePair,
  llmJudge,
  writeJudgeRecord,
  type AskJudge,
} from "#build/judge.ts";
import { BuildWorkspace } from "#build/workspace.ts";

export type Bout = {
  incumbent: string;
  challenger: string;
  winner: "incumbent" | "challenger" | "tie";
  confidence: number;
  record: string;
};

export type KnockoutResult = {
  best: string;
  score: number | null;
  bouts: Bout[];
};

type Sheet = { data: Uint8Array; mediaType: "image/png"; file: string };

async function sheetsFor(
  dir: string,
  names: readonly string[],
  rubric: JudgeRubric,
): Promise<Map<string, Sheet>> {
  const renderer = new Renderer(await ensureAssets());
  const sheets = new Map<string, Sheet>();
  for (const name of names) {
    const grid = await candidateGrid(dir, name);
    const image = await renderer.judgeSheet(grid, {
      kind: rubric,
      label: "X",
    });
    // A missing texture would show the fallback checker to the judge.
    assertTexturesPresent(renderer, `knockout sheet for candidate "${name}"`);
    const data = new Uint8Array(await encodePng(image));
    const hash = createHash("sha256").update(data).digest("hex");
    const file = path.join(
      path.resolve(dir),
      "judge",
      `candidate-${name}-${hash}.png`,
    );
    await Bun.write(file, data);
    sheets.set(name, {
      data,
      mediaType: "image/png",
      file,
    });
  }
  return sheets;
}

function sheetOf(sheets: Map<string, Sheet>, name: string): Sheet {
  const sheet = sheets.get(name);
  if (sheet === undefined)
    throw new Error(`no judge sheet for candidate ${name}`);
  return sheet;
}

/** Who starts as incumbent and who challenges: `manifest.best` when saved, else the first of the pool. */
function seeding(
  pool: readonly string[],
  saved: readonly string[],
  best: string | undefined,
): { incumbent: string; challengers: string[] } {
  const [first] = pool;
  if (first === undefined) {
    throw new Error(
      "no candidates to judge; toolkit mc build candidate <dir> save --name <n> first",
    );
  }
  const incumbent = best !== undefined && saved.includes(best) ? best : first;
  return {
    incumbent,
    challengers: pool.filter((name) => name !== incumbent),
  };
}

async function persistBest(
  workspace: BuildWorkspace,
  manifest: BuildManifest,
  incumbent: string,
  rubric: JudgeRubric,
): Promise<NonNullable<BuildManifest["best"]>> {
  const candidate = await readCandidate(workspace.dir, incumbent);
  const best = {
    candidate: incumbent,
    gridHash: candidate.gridHash,
    rubric,
    score: await candidateScore(workspace.dir, incumbent, rubric),
  };
  const unchanged =
    manifest.best?.candidate === best.candidate &&
    manifest.best.gridHash === best.gridHash &&
    manifest.best.rubric === best.rubric &&
    manifest.best.score === best.score;
  if (unchanged && manifest.best !== undefined) return manifest.best;
  await workspace.writeManifest({ ...manifest, best });
  return best;
}

async function bout(
  dir: string,
  pair: { incumbent: string; challenger: string; sheets: Map<string, Sheet> },
  options: { rubric: JudgeRubric; model: string; ask: AskJudge },
): Promise<Bout> {
  const { incumbent, challenger } = pair;
  const verdict = await judgePair(
    sheetOf(pair.sheets, incumbent),
    sheetOf(pair.sheets, challenger),
    options.ask,
    options.model,
  );
  const recordFile = await writeJudgeRecord(dir, {
    kind: "pair",
    at: new Date().toISOString(),
    model: options.model,
    rubric: options.rubric,
    judge: judgeFingerprint(options.rubric),
    a: path.relative(path.resolve(dir), sheetOf(pair.sheets, incumbent).file),
    b: path.relative(path.resolve(dir), sheetOf(pair.sheets, challenger).file),
    winner: verdict.winner,
    confidence: verdict.confidence,
    agreed: verdict.agreed,
    reasons: verdict.reasons,
  });
  const file = path.relative(path.resolve(dir), recordFile);
  const challengerWins = verdict.winner === "b";
  const [kept, dropped] = challengerWins
    ? [challenger, incumbent]
    : [incumbent, challenger];
  await appendLog(dir, {
    kind: "accept",
    candidate: kept,
    versus: dropped,
    file,
    rubric: options.rubric,
    score: await candidateScore(dir, kept, options.rubric),
  });
  await appendLog(dir, {
    kind: "reject",
    candidate: dropped,
    versus: kept,
    file,
    rubric: options.rubric,
    score: await candidateScore(dir, dropped, options.rubric),
  });
  return {
    incumbent,
    challenger,
    winner:
      verdict.winner === "tie"
        ? "tie"
        : challengerWins
          ? "challenger"
          : "incumbent",
    confidence: verdict.confidence,
    record: file,
  };
}

/**
 * Runs the tournament. `among` limits the challengers; the incumbent is
 * always in the pool. With no incumbent yet, the first candidate starts as
 * one and meets the rest.
 */
export async function knockout(
  dir: string,
  options: {
    among?: string[];
    rubric: JudgeRubric;
    model: string;
    ask?: AskJudge;
  },
): Promise<KnockoutResult> {
  const workspace = new BuildWorkspace(dir);
  let manifest = await workspace.manifest();
  const candidates = await listCandidates(dir);
  const saved = candidates.map((candidate) => candidate.name);
  const pool = options.among ?? saved;
  if (new Set(pool).size !== pool.length) {
    throw new Error("knockout candidate names must be unique");
  }
  for (const name of pool) {
    if (!saved.includes(name)) {
      throw new Error(`no candidate "${name}" saved in ${workspace.dir}`);
    }
  }
  const seeds = seeding(pool, saved, manifest.best?.candidate);
  const sheets = await sheetsFor(
    dir,
    [seeds.incumbent, ...seeds.challengers],
    options.rubric,
  );
  const ask = options.ask ?? llmJudge(options.model, options.rubric);
  const bouts: Bout[] = [];
  let incumbent = seeds.incumbent;
  for (const challenger of seeds.challengers) {
    const result = await bout(
      dir,
      { incumbent, challenger, sheets },
      { ...options, ask },
    );
    bouts.push(result);
    incumbent = result.winner === "challenger" ? challenger : incumbent;
    // A later model failure must retry from the winner already recorded in the journal.
    manifest = {
      ...manifest,
      best: await persistBest(workspace, manifest, incumbent, options.rubric),
    };
  }
  const best = await persistBest(
    workspace,
    manifest,
    incumbent,
    options.rubric,
  );
  if (seeds.challengers.length === 0 && manifest.best !== best) {
    // No bout produces an accept entry when the pool contains only the incumbent.
    await appendLog(dir, {
      kind: "accept",
      candidate: incumbent,
      versus: null,
      file: null,
      rubric: options.rubric,
      score: best.score,
    });
  }
  return { best: incumbent, score: best.score, bouts };
}
