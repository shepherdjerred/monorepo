import { parseArgs } from "node:util";
import { deployedCommand } from "#commands/deployed/deployed.ts";

const USAGE = `
toolkit deployed - is my commit/service deployed to the homelab?

Usage:
  toolkit deployed [<selector>] [--commit <ref>] [options]

Selector:
  (none)                 HEAD — auto-detect affected k8s services
  <commit-ish>           a SHA/ref (be49fdd3, HEAD~3) — services it affects
  <service>              e.g. scout, birmel, streambot — all its variants,
                           defaulting --commit to the latest commit for that pkg
  <service>/<variant>    e.g. scout/prod, scout/beta — just that product

Options:
  --commit <ref>         Override the commit to check
  --json                 Output as JSON
  --no-cluster           Skip ArgoCD + kubectl (git/gh only)
  --no-github            Skip gh PR lookups

Examples:
  toolkit deployed                       # is HEAD deployed?
  toolkit deployed scout                 # is scout's latest commit live (beta+prod)?
  toolkit deployed scout/prod            # ...just prod
  toolkit deployed birmel --commit abc123
  toolkit deployed be49fdd3              # which services does this commit affect, live?
`;

export async function handleDeployedCommand(
  subcommand: string | undefined,
  args: string[],
): Promise<void> {
  if (subcommand === "--help" || subcommand === "-h") {
    console.log(USAGE);
    process.exit(0);
  }

  const { values, positionals } = parseArgs({
    args,
    options: {
      commit: { type: "string" },
      json: { type: "boolean", default: false },
      "no-cluster": { type: "boolean", default: false },
      "no-github": { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  const selector = positionals[0];

  await deployedCommand({
    selector,
    commit: values.commit,
    json: values.json,
    noCluster: values["no-cluster"],
    noGithub: values["no-github"],
  });
}
