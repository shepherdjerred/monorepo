import { Client, Connection } from "@temporalio/client";
import {
  auditNamespaceMigration,
  cutoverNamespaceMigration,
  inventoryMigrationSchedules,
  prepareNamespaceMigration,
  rollbackNamespaceMigration,
  type MigrationTargetNamespace,
} from "#schedules/namespace-migration.ts";
import { temporalConnectionOptions } from "#lib/temporal-connection.ts";

const DEFAULT_ADDRESS = "127.0.0.1:7233";

type Command = "prepare" | "cutover" | "rollback" | "audit";

function parseCommand(): {
  command: Command;
  confirm: boolean;
  cutoverAt: Date | undefined;
} {
  const command = process.argv[2];
  if (
    command !== "prepare" &&
    command !== "cutover" &&
    command !== "rollback" &&
    command !== "audit"
  ) {
    throw new TypeError(
      "Usage: migrate-namespaces.ts <prepare|cutover|rollback|audit> [--confirm] [--cutover-at <ISO timestamp>]",
    );
  }
  let confirm = false;
  let cutoverAt: Date | undefined;
  for (let index = 3; index < process.argv.length; index += 1) {
    const argument = process.argv[index];
    if (argument === "--confirm") {
      confirm = true;
      continue;
    }
    if (argument === "--cutover-at") {
      const value = process.argv[index + 1];
      if (value === undefined) {
        throw new TypeError("--cutover-at requires a value");
      }
      cutoverAt = new Date(value);
      if (Number.isNaN(cutoverAt.getTime())) {
        throw new TypeError(`Invalid --cutover-at timestamp: ${value}`);
      }
      index += 1;
      continue;
    }
    throw new TypeError(`Unknown argument: ${argument ?? "undefined"}`);
  }
  return { command, confirm, cutoverAt };
}

async function main(): Promise<void> {
  const options = parseCommand();
  const connection = await Connection.connect(
    temporalConnectionOptions({
      environment: Bun.env,
      defaultAddress: DEFAULT_ADDRESS,
    }),
  );
  try {
    const sourceClient = new Client({ connection, namespace: "default" });
    const targetClients = new Map<MigrationTargetNamespace, Client>([
      ["prod", new Client({ connection, namespace: "prod" })],
      ["beta", new Client({ connection, namespace: "beta" })],
    ]);
    const schedules = await inventoryMigrationSchedules(sourceClient);
    console.warn(
      JSON.stringify({
        command: options.command,
        dryRun: !options.confirm,
        scheduleCount: schedules.length,
        targets: Object.fromEntries(
          ["prod", "beta"].map((namespace) => [
            namespace,
            schedules.filter(
              (schedule) => schedule.targetNamespace === namespace,
            ).length,
          ]),
        ),
        schedules: schedules.map((schedule) => ({
          scheduleId: schedule.source.scheduleId,
          sourceNamespace: "default",
          targetNamespace: schedule.targetNamespace,
          sourcePaused: schedule.source.state.paused,
          sourceNote: schedule.source.state.note,
        })),
      }),
    );
    let cutoverAt: Date | undefined;
    switch (options.command) {
      case "prepare":
        await prepareNamespaceMigration({
          schedules,
          targetClients,
          confirm: options.confirm,
        });
        break;
      case "cutover":
        cutoverAt = new Date();
        await cutoverNamespaceMigration({
          sourceClient,
          schedules,
          targetClients,
          confirm: options.confirm,
        });
        break;
      case "rollback":
        await rollbackNamespaceMigration({
          sourceClient,
          schedules,
          targetClients,
          confirm: options.confirm,
        });
        break;
      case "audit":
        if (options.cutoverAt === undefined) {
          throw new TypeError("audit requires --cutover-at <ISO timestamp>");
        }
        await auditNamespaceMigration({
          sourceClient,
          schedules,
          targetClients,
          cutoverAt: options.cutoverAt,
        });
        break;
    }
    console.warn(
      JSON.stringify({
        command: options.command,
        status: "complete",
        ...(cutoverAt === undefined
          ? {}
          : { cutoverAt: cutoverAt.toISOString() }),
      }),
    );
  } finally {
    await connection.close();
  }
}

await main();
