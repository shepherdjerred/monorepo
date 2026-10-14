import { ActorSchema } from "@shepherdjerred/tracker/contract";
import { createExport, runImport } from "#lib/tracker/migration/runner.ts";
import { backupExport } from "#lib/tracker/migration/backup.ts";
import { verifyFrozenExport } from "#lib/tracker/migration/verify.ts";
import { catchUpLinear } from "#lib/tracker/migration/catch-up.ts";
import { required, type TrackerOptions } from "./options.ts";
import type { TrackerCommandContext } from "./issues.ts";

export async function migrationCommand(
  context: TrackerCommandContext,
  args: string[],
  options: TrackerOptions,
) {
  const action = required(
    args[0],
    "migration action (export-linear, import-linear)",
  );
  if (action === "export-linear")
    return createExport(required(options.output, "--output"), options.resume);
  if (action === "verify-linear")
    return verifyFrozenExport(required(options.input, "--input"));
  if (action === "backup-linear")
    return backupExport(
      required(options.input, "--input"),
      required(options.profile, "--profile"),
    );
  if (action === "catch-up-linear")
    return catchUpLinear({
      directory: required(options.input, "--input"),
      previous: required(options.previous, "--previous"),
      retainRemoved: options["retain-removed"] ?? [],
      retentionSource: options["retention-source"],
      actor: options["dry-run"]
        ? ActorSchema.parse({
            key: "runner:migration-dry-run",
            kind: "runner",
            name: "Migration dry-run",
            metadata: {},
          })
        : await context.actor(),
      client: context.client,
      dryRun: options["dry-run"],
    });
  if (action !== "import-linear")
    throw new Error("Unknown migration action: " + action);
  return runImport({
    directory: required(options.input, "--input"),
    // A dry-run needs neither a session identity nor a reachable destination.
    actor: options["dry-run"]
      ? ActorSchema.parse({
          key: "runner:migration-dry-run",
          kind: "runner",
          name: "Migration dry-run",
          metadata: {},
        })
      : await context.actor(),
    client: context.client,
    dryRun: options["dry-run"],
    only: options.only,
  });
}
