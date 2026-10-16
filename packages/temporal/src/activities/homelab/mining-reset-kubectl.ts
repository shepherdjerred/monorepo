import { z } from "zod";
import maintenanceContract from "@shepherdjerred/the-storm/maintenance-status.json" with { type: "json" };
import {
  MINING_NAMESPACE,
  MINING_SERVER,
  StatefulSetSchema,
  ServiceSchema,
} from "./mining-reset-contract.ts";

export type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type Command = (
  args: readonly string[],
  input?: string,
) => Promise<CommandResult>;

export async function kubectl(
  args: readonly string[],
  input?: string,
): Promise<CommandResult> {
  const process = Bun.spawn(["kubectl", ...args], {
    stdin: input === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (input !== undefined) {
    if (process.stdin === undefined) {
      throw new Error("kubectl stdin pipe was not created");
    }
    await process.stdin.write(input);
    await process.stdin.end();
  }
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { stdout, stderr, exitCode };
}

export function commandFailure(
  args: readonly string[],
  result: CommandResult,
): Error {
  // These commands read only fixed Kubernetes resources. Keep API errors but
  // never log manifest input, which can include deployment environment values.
  return new Error(
    `kubectl ${args.join(" ")} failed (${String(result.exitCode)}): ${result.stderr.trim()}`,
  );
}

export async function run(
  command: Command,
  args: readonly string[],
  input?: string,
): Promise<string> {
  const result = await command(args, input);
  if (result.exitCode !== 0) {
    throw commandFailure(args, result);
  }
  return result.stdout;
}

export async function readOptional(
  command: Command,
  args: readonly string[],
): Promise<string | undefined> {
  const result = await command(args);
  if (result.exitCode === 0) {
    return result.stdout;
  }
  if (
    result.stderr.includes("NotFound") ||
    result.stderr.includes("not found")
  ) {
    return undefined;
  }
  throw commandFailure(args, result);
}

export async function readServer(command: Command) {
  return StatefulSetSchema.parse(
    JSON.parse(
      await run(command, [
        "-n",
        MINING_NAMESPACE,
        "get",
        "statefulset",
        MINING_SERVER,
        "-o",
        "json",
      ]),
    ),
  );
}

export async function readService(command: Command) {
  return ServiceSchema.parse(
    JSON.parse(
      await run(command, [
        "-n",
        MINING_NAMESPACE,
        "get",
        "service",
        MINING_SERVER,
        "-o",
        "json",
      ]),
    ),
  );
}

export async function patchJson(
  command: Command,
  kind: "statefulset" | "service",
  patch: readonly object[],
): Promise<void> {
  await run(command, [
    "-n",
    MINING_NAMESPACE,
    "patch",
    kind,
    MINING_SERVER,
    "--type=json",
    "-p",
    JSON.stringify(patch),
  ]);
}

export function annotationPath(key: string): string {
  return `/metadata/annotations/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
}

const MaintenanceReplySchema = z
  .object({
    schemaVersion: z.literal(maintenanceContract.schemaVersion),
    owner: z.string().regex(new RegExp(maintenanceContract.ownerPattern)),
    state: z.enum(maintenanceContract.states),
    players: z.number().int().nonnegative(),
  })
  .strict();

export async function closeAdmission(
  command: Command,
  period: string,
): Promise<boolean> {
  const reply = MaintenanceReplySchema.parse(
    JSON.parse(
      await run(command, [
        "exec",
        "-n",
        MINING_NAMESPACE,
        `${MINING_SERVER}-0`,
        "-c",
        "minecraft",
        "--",
        "rcon-cli",
        `storm-maintenance begin ${period}`,
      ]),
    ),
  );
  if (reply.owner !== period)
    throw new Error("Maintenance reply belongs to another reset");
  if (reply.state === "occupied" && reply.players > 0) return false;
  if (reply.state !== "ready" || reply.players !== 0) {
    throw new Error(`Cannot close The Storm admission: ${reply.state}`);
  }
  return true;
}
