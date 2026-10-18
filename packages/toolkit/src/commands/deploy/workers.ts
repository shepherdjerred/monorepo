import { z } from "zod";
import type { DeliveryClient } from "@shepherdjerred/delivery/client";
import {
  RegisterWorkerVersionSchema,
  CreateDeploymentSchema,
  RequestWorkerRecoverySchema,
} from "@shepherdjerred/delivery/contract";
import type { DeployOptions } from "./common.ts";

export function validateWorkerCommand(
  positionals: string[],
  options: DeployOptions,
) {
  const [action] = positionals;
  const arities: Record<string, number> = {
    list: 2,
    retire: 3,
    adopt: 1,
    baseline: 1,
    recover: 2,
    recovery: 2,
  };
  const arity = arities[action ?? ""];
  if (arity === undefined || positionals.length !== arity)
    throw new Error(
      "Use deploy workers list <ENVIRONMENT>, baseline|adopt --file <PATH> --machine, or retire <ENVIRONMENT> <WORKER_ID>",
    );
  if (
    ["adopt", "baseline"].includes(action ?? "") &&
    (options.file === undefined || !options.machine)
  )
    throw new Error(
      "Worker adoption requires --file and an admin --machine credential",
    );
  if (options["expected-worker-generation"] !== undefined)
    z.coerce
      .number()
      .int()
      .nonnegative()
      .parse(options["expected-worker-generation"]);
  if (action === "recover") {
    if (!options.machine)
      throw new Error("Worker recovery requires an admin --machine credential");
    if (options["expected-generation"] === undefined)
      throw new Error(
        "Worker recovery requires --expected-generation from the reviewed deployment environment",
      );
    z.string().min(20).max(4000).parse(options.reason);
  }
}

export async function runWorkerCommand(
  client: DeliveryClient,
  positionals: string[],
  options: DeployOptions & { requestNotice?: (id: string) => void },
) {
  const [action, environmentId, workerId] = positionals;
  if (action === "recover" || action === "recovery")
    return runWorkerRecovery(client, {
      action,
      target: environmentId,
      options,
    });
  if (action === "adopt" || action === "baseline") {
    if (options.file === undefined) throw new Error("--file is required");
    const raw: unknown = await Bun.file(options.file).json();
    if (action === "baseline") {
      const input = CreateDeploymentSchema.parse(raw);
      if (input.kind !== "adopt-worker")
        throw new Error("Worker baseline file must request kind adopt-worker");
      options.requestNotice?.(input.requestId);
      return { result: await client.createDeployment(input), exitCode: 0 };
    }
    return {
      result: await client.registerWorker(
        RegisterWorkerVersionSchema.parse(raw),
      ),
      exitCode: 0,
    };
  }
  if (environmentId === undefined)
    throw new Error("Explicit environment is required");
  const pool = await client.workers(environmentId);
  if (action === "list") return { result: pool, exitCode: 0 };
  const worker = pool.versions.find((version) => version.id === workerId);
  if (worker === undefined)
    throw new Error(
      `Unknown worker in ${environmentId}: ${workerId ?? "missing"}`,
    );
  const requestId = options["request-id"] ?? crypto.randomUUID();
  options.requestNotice?.(requestId);
  const generation = (value: string | undefined, current: number) =>
    value === undefined
      ? current
      : z.coerce.number().int().nonnegative().parse(value);
  return {
    result: await client.retireWorker(worker.id, {
      requestId,
      expectedEnvironmentGeneration: generation(
        options["expected-generation"],
        pool.generation,
      ),
      expectedWorkerGeneration: generation(
        options["expected-worker-generation"],
        worker.generation,
      ),
    }),
    exitCode: 0,
  };
}

async function runWorkerRecovery(
  client: DeliveryClient,
  input: {
    action: "recover" | "recovery";
    target: string | undefined;
    options: DeployOptions & { requestNotice?: (id: string) => void };
  },
) {
  if (input.target === undefined)
    throw new Error(
      "Explicit worker deployment or recovery intent is required",
    );
  if (input.action === "recovery")
    return { result: await client.workerRecovery(input.target), exitCode: 0 };
  const request = RequestWorkerRecoverySchema.parse({
    requestId: input.options["request-id"] ?? crypto.randomUUID(),
    expectedEnvironmentGeneration: Number(input.options["expected-generation"]),
    reason: input.options.reason,
  });
  input.options.requestNotice?.(request.requestId);
  return {
    result: await client.requestWorkerRecovery(input.target, request),
    exitCode: 0,
  };
}
