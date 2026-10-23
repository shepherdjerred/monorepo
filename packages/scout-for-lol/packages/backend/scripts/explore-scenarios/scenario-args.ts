import path from "node:path";
import { homedir } from "node:os";
import {
  ExploreScenarioSurfaceSchema,
  type ExploreScenarioSurface,
} from "@scout-for-lol/data";

export type ScenarioCliOptions = {
  readonly only: readonly string[];
  readonly surfaces: readonly ExploreScenarioSurface[];
  readonly concurrency: number;
  readonly judge: boolean;
  readonly write: boolean;
  readonly sourceLake: string;
  readonly model: string;
};

export const SCENARIO_USAGE = [
  "Usage: bun run test:explore:scenarios -- [options]",
  "",
  "  --only <id,id>          Run only these case ids",
  "  --surfaces <list>       web,discord,voice (default: each case's own list)",
  "  --concurrency <n>       Runs in flight at once (default 3)",
  "  --no-judge              Skip the rubric judge; deterministic checks only",
  "  --write                 Write the summary report next to the code",
  "  --source-lake <dir>     Lake to copy (default: the pulled prod dataset)",
  "  --model <id>            Explore model (default gpt-5.6-luna, prod's)",
].join("\n");

function defaultSourceLake(): string {
  const xdg = Bun.env["XDG_DATA_HOME"];
  return path.join(
    xdg !== undefined && xdg.length > 0
      ? xdg
      : path.join(homedir(), ".local", "share"),
    "scout-for-lol",
    "stage-dataset",
    "prod",
    "report-lake",
  );
}

export function parseScenarioArgs(
  argv: readonly string[],
): { kind: "help" } | { kind: "run"; options: ScenarioCliOptions } {
  let only: string[] = [];
  let surfaces: ExploreScenarioSurface[] = [];
  let concurrency = 3;
  let judge = true;
  let write = false;
  let sourceLake = defaultSourceLake();
  let model = "gpt-5.6-luna";

  const value = (index: number, flag: string): string => {
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      throw new Error(`${flag} needs a value.`);
    }
    return next;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index] ?? "";
    switch (flag) {
      case "--help":
        return { kind: "help" };
      case "--only":
        only = value(index, flag)
          .split(",")
          .filter((id) => id.length > 0);
        index += 1;
        break;
      case "--surfaces":
        surfaces = value(index, flag)
          .split(",")
          .map((surface) => ExploreScenarioSurfaceSchema.parse(surface));
        index += 1;
        break;
      case "--concurrency":
        concurrency = Number.parseInt(value(index, flag), 10);
        if (!Number.isInteger(concurrency) || concurrency < 1) {
          throw new Error("--concurrency must be a positive integer.");
        }
        index += 1;
        break;
      case "--no-judge":
        judge = false;
        break;
      case "--write":
        write = true;
        break;
      case "--source-lake":
        sourceLake = path.resolve(value(index, flag));
        index += 1;
        break;
      case "--model":
        model = value(index, flag);
        index += 1;
        break;
      default:
        throw new Error(`Unknown option ${flag}.\n\n${SCENARIO_USAGE}`);
    }
  }
  return {
    kind: "run",
    options: { only, surfaces, concurrency, judge, write, sourceLake, model },
  };
}
