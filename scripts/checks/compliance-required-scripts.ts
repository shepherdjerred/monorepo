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
