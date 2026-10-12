/** `build candidate …` and `build scratch`: keep versions, pick one, try things aside. */
import { print, type Handler } from "#build/command-kit.ts";
import {
  listCandidates,
  pickCandidate,
  readCandidate,
  saveCandidate,
} from "./candidates.ts";
import { createScratch } from "#build/scratch.ts";
import type { Candidate } from "#protocol/build.ts";

type Values = {
  json: boolean;
  name?: string;
  force: boolean;
  among?: string;
  model?: string;
  rubric?: string;
  size?: string;
};

export const CANDIDATE_USAGE = `  candidate <dir> save --name <n> [--force]   Keep the program and op log (compiled offline) as candidates/<n>/
  candidate <dir> ls | show <n> | pick <n>    List, inspect, or restore a candidate as the working version
  candidate <dir> knockout [--among a,b] [--rubric micro|map] [--model id]
                                        Blind pairwise bouts against the incumbent; the winner becomes build.json "best"
  scratch <dir> [--size n]              A void pad beside the site (scratch/, its own build dir) for trying pieces`;

function line(candidate: Candidate & { best?: boolean }): string {
  const score =
    candidate.score === null
      ? "unscored"
      : `critique ${candidate.score.total.toString()} (${candidate.score.rubric})`;
  return `${candidate.best === true ? "* " : "  "}${candidate.name.padEnd(16)} iter ${candidate.iteration.toString().padStart(2)}  ${candidate.blocks.toString().padStart(7)} blocks  ${score}  ${candidate.gridHash.slice(0, 12)}`;
}

async function knockoutCommand(dir: string, values: Values): Promise<number> {
  const [{ knockout }, judge] = await Promise.all([
    import("./knockout.ts"),
    import("#build/judge.ts"),
  ]);
  const result = await knockout(dir, {
    ...(values.among === undefined
      ? {}
      : {
          among: values.among
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0),
        }),
    rubric: judge.parseRubric(values.rubric),
    model: values.model ?? judge.DEFAULT_JUDGE_MODEL,
  });
  print(
    values.json,
    result,
    [
      ...result.bouts.map(
        (bout) =>
          `  ${bout.incumbent} vs ${bout.challenger}: ${bout.winner === "tie" ? "tie, incumbent stays" : `${bout.winner} wins`} (${bout.confidence.toFixed(2)}) → ${bout.record}`,
      ),
      `best: ${result.best}${result.score === null ? "" : ` (critique ${result.score.toString()})`}${result.bouts.length === 0 ? " (no challengers)" : ""}`,
    ].join("\n"),
  );
  return 0;
}

const SUBCOMMANDS: Record<
  string,
  (dir: string, values: Values, rest: string[]) => Promise<number>
> = {
  save: async (dir, values) => {
    if (values.name === undefined)
      throw new Error("candidate save needs --name <n>");
    const candidate = await saveCandidate(dir, values.name, {
      force: values.force,
    });
    print(values.json, candidate, `saved candidate\n${line(candidate)}`);
    return 0;
  },
  ls: async (dir, values) => {
    const candidates = await listCandidates(dir);
    print(
      values.json,
      candidates,
      candidates.length === 0
        ? "no candidates saved"
        : candidates.map((candidate) => line(candidate)).join("\n"),
    );
    return 0;
  },
  show: async (dir, values, rest) => {
    const [name] = rest;
    if (name === undefined) throw new Error("candidate show needs a name");
    const candidate = await readCandidate(dir, name);
    print(values.json, candidate, [line(candidate)].join("\n"));
    return 0;
  },
  pick: async (dir, values, rest) => {
    const [name] = rest;
    if (name === undefined) throw new Error("candidate pick needs a name");
    const candidate = await pickCandidate(dir, name);
    print(
      values.json,
      candidate,
      `restored ${name} as the working version (build.ts${candidate.program ? "" : " absent"}, op log); run and render it to continue`,
    );
    return 0;
  },
  knockout: (dir, values) => knockoutCommand(dir, values),
};

export const CANDIDATE_HANDLERS: Record<string, Handler<Values>> = {
  candidate: async (_env, dir, values, rest) => {
    const [sub, ...more] = rest;
    const run = sub === undefined ? undefined : SUBCOMMANDS[sub];
    if (run === undefined) {
      throw new Error(
        `candidate needs one of ${Object.keys(SUBCOMMANDS).join("|")}\n${CANDIDATE_USAGE}`,
      );
    }
    return run(dir, values, more);
  },
  scratch: async (_env, dir, values) => {
    const result = await createScratch(
      dir,
      values.size === undefined ? {} : { size: Number(values.size) },
    );
    print(
      values.json,
      result,
      `scratch pad ${result.dir}: ${result.size.toString()}³ void at ${result.anchor.x.toString()},${result.anchor.y.toString()},${result.anchor.z.toString()}\n  author ${result.dir}/build.ts, then: toolkit mc build compile ${result.dir} && toolkit mc build render ${result.dir} --source compiled`,
    );
    return 0;
  },
};
