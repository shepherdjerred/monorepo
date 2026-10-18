import { parseArgs } from "node:util";
import { z } from "zod";
import { GitHubClient } from "#lib/ci/github.ts";
import { githubToken } from "#lib/ci/process.ts";
import { CiObserver } from "#lib/ci/observer.ts";
import {
  collectSourceProof,
  SourceAncestrySchema,
} from "#lib/ci/source-proof.ts";
import { loadWoodpeckerConfig } from "#lib/woodpecker/ci.ts";
import { resolveCredentials } from "#lib/credentials.ts";
import { sanitizeText } from "#lib/ci/redaction.ts";

export async function ciSourceProofCommand(args: string[]) {
  try {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        source: { type: "string" },
        json: { type: "boolean", default: false },
      },
    });
    if (positionals.length !== 1)
      throw new Error(
        "Use toolkit ci source-proof <PR> --source <40SHA> --json",
      );
    const number = z.coerce.number().int().positive().parse(positionals[0]);
    const source = z
      .string()
      .regex(/^[a-f0-9]{40}$/u)
      .parse(values.source);
    await resolveCredentials(["WOODPECKER_TOKEN"]);
    const github = new GitHubClient(await githubToken());
    const config = await loadWoodpeckerConfig();
    if (config.baseUrl !== "https://woodpecker.sjer.red" || config.repoId !== 1)
      throw new Error(
        "Bootstrap source proof requires the canonical monorepo CI connection",
      );
    const observer = new CiObserver(github, config);
    const signal = AbortSignal.timeout(90_000);
    const proof = await collectSourceProof(source, {
      snapshot: () => observer.snapshot(number, signal, true),
      compare: (revision, main) =>
        github.read(
          `/repos/${github.repo}/compare/${revision}...${main}`,
          SourceAncestrySchema,
          signal,
        ),
    });
    console.log(
      sanitizeText(JSON.stringify(proof, null, values.json ? undefined : 2), [
        github.token,
        config.token,
      ]),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (args.includes("--json"))
      console.log(
        JSON.stringify({ outcome: "error", ready: false, error: message }),
      );
    else console.error(message);
    process.exitCode = 2;
  }
}
