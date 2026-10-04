import { z } from "zod";
import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { loadConfig } from "#src/runtime/config.ts";
import type { LinearIssue } from "#src/domain/schemas.ts";
import type { RuntimePaths } from "#src/runtime/paths.ts";

/** Host-only policy: the coding container never loads the flag client. */
export async function autonomyEnabled(
  issue: LinearIssue,
  paths: RuntimePaths,
): Promise<boolean> {
  const config = await loadConfig(paths);
  const targetingKey = `${config.repository.slug}:${issue.identifier}`;
  const resolver = defineConfig({
    definition: {
      autonomousDevexEnabled: {
        schema: z.boolean(),
        sources: ["flag", "file"],
        default: false,
        targeted: true,
        names: { flag: "justin_autonomous_devex_enabled" },
      },
    },
    sources: {
      flag: createFlagConfigSource({
        targetingKey,
        kinds: { autonomousDevexEnabled: "boolean" },
        attributes: { issue: issue.identifier, team: issue.team?.key ?? "" },
      }),
      file: {
        name: "file",
        get: () =>
          Promise.resolve({
            value: config.autonomy.enabledIssueIdentifiers.includes(
              issue.identifier,
            ),
          }),
      },
    },
    hooks: {
      onSourceError: (_key, source, message) => {
        console.error(`Autonomy policy source ${source} failed: ${message}`);
      },
    },
  });
  return await resolver.value("autonomousDevexEnabled", { targetingKey });
}
