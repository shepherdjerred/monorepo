import { z } from "zod";
import { isNoopScript } from "../misc/migration-core.ts";

/** Local verification may rename a package's build and test scripts. */
export function requiredScriptName(
  script: "build" | "test" | "lint" | "typecheck",
  localNames:
    { build?: string | undefined; test?: string | undefined } | undefined,
): string {
  return script === "build" || script === "test"
    ? (localNames?.[script] ?? script)
    : script;
}

const PackageTurboSchema = z
  .object({
    tasks: z
      .record(
        z.string(),
        z.object({ dependsOn: z.array(z.string()).optional() }).loose(),
      )
      .optional(),
  })
  .loose();

/**
 * A package may run lint or typecheck as separate cached chains: Turbo's
 * `<script>` is then a transit task with no package script, and every task it
 * depends on is the package's own `<script>:<part>` script doing real work.
 */
export async function satisfiedByTransitTask(
  root: string,
  directory: string,
  scripts: Readonly<Record<string, string>> | undefined,
  script: string,
): Promise<boolean> {
  if (script !== "lint" && script !== "typecheck") return false;
  if (scripts?.[script] !== undefined) return false;
  const file = Bun.file(`${root}/${directory}/turbo.json`);
  if (!(await file.exists())) return false;
  const turbo = PackageTurboSchema.parse(Bun.JSONC.parse(await file.text()));
  const dependsOn = turbo.tasks?.[script]?.dependsOn ?? [];
  return (
    dependsOn.length > 0 &&
    dependsOn.every((task) => {
      const command = scripts?.[task];
      return (
        task.startsWith(`${script}:`) &&
        command !== undefined &&
        !isNoopScript(command)
      );
    })
  );
}

export const complianceExemptions = new Set(
  `
packages/glitter:lint
packages/glitter:typecheck
packages/resume:test
packages/resume:lint
packages/resume:typecheck
packages/monarch:build
packages/llm-observability:build
packages/discord-plays-core:build
packages/trmnl-dashboard:build
packages/tasks-for-obsidian:build
packages/starlight-karma-bot:build
packages/facet-protocol:build
packages/facet-protocol:test
packages/facet-protocol:lint
packages/facet-protocol:typecheck
packages/tasknotes-macos:build
packages/tasknotes-macos:typecheck
packages/windows-cross-compiler:build
packages/code-review:build
packages/architecture:build
packages/cooklang-rich-preview:test
packages/cross-compilers-site:test
packages/stocks-sjer-red:test
packages/landing-pages:test
packages/discord-video-stream:lint
packages/discord-plays-mario-kart/packages/common:test
packages/discord-plays-pokemon/packages/common:test
packages/scout-for-lol/packages/data:build
packages/scout-for-lol/packages/report:build
packages/hkctl:build
packages/hkctl:test
packages/hkctl:typecheck
packages/macos-cross-compiler:build
packages/macos-cross-compiler:test
packages/macos-cross-compiler:lint
packages/macos-cross-compiler:typecheck
packages/sjer.red:test
packages/release-tools:build
packages/release-tools:lint
packages/release-tools:typecheck
packages/temporal:build
packages/temporal-observability:build
packages/discord-plays-pokemon/packages/backend:build
packages/discord-plays-mario-kart/packages/backend:build
packages/macos-ai-subscription-tracker:build
packages/macos-ai-subscription-tracker:test
packages/macos-ai-subscription-tracker:lint
packages/macos-ai-subscription-tracker:typecheck
packages/homelab:build
packages/dotfiles:build
packages/discord-plays-mario-kart:build
packages/discord-plays-pokemon:build
packages/scout-for-lol:build
packages/scout-for-lol/packages/temporal:build
packages/scout-for-lol/packages/domain:build
`
    .trim()
    .split("\n"),
);
