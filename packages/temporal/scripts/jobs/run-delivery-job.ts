import {
  WorkerRolloutPlanSchema,
  WorkerRolloutActionSchema,
} from "@shepherdjerred/delivery/contract";
import type { WorkerRolloutSnapshot } from "@shepherdjerred/delivery/contract";
import { z } from "zod";
import {
  DeliveryJobRequestSchema,
  DELIVERY_JOB_RESULT_PREFIX,
} from "#shared/delivery-job.ts";
import {
  verifyDeliveryWorkerImages,
  WorkerImageProofInputSchema,
} from "#lib/delivery/workers/worker-image-proof.ts";
import { renderControlPlaneTemplates } from "#lib/delivery/workers/worker-control-plane.ts";
import { withWorkerCandidateCheckout } from "#lib/delivery/workers/worker-candidate-checkout.ts";
import { WorkerDeploymentRolloutTargetSchema } from "#lib/worker-deployment-target.ts";
import { WorkerRoutingInputSchema } from "#lib/delivery/workers/worker-acceptance.ts";
import { redactSecrets } from "#shared/redact.ts";
import { runTestStage } from "./test-stage.ts";

const COMMAND_OUTPUT_TAIL_LIMIT = 1500;
const PROMETHEUS_QUERY_ATTEMPTS = 3;
const PROMETHEUS_RETRY_DELAY_MS = 250;

const ConnectionSchema = z.object({
  address: z.literal(
    "temporal-temporal-server-service.temporal.svc.cluster.local:7233",
  ),
});

function secretEnvironmentValues(
  env: Readonly<Record<string, string | undefined>> = Bun.env,
): string[] {
  return Object.entries(env)
    .filter(
      ([key, value]) =>
        value !== undefined &&
        /TOKEN|SECRET|PASSWORD|KEY|CREDENTIAL|AUTH/iu.test(key),
    )
    .map(([, value = ""]) => value);
}

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function isNonRetryablePrometheusHttpError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.startsWith("Worker metrics query returned HTTP 4") &&
    !error.message.startsWith("Worker metrics query returned HTTP 429")
  );
}

async function prometheusHttpFailure(
  response: Response,
  secrets: readonly string[],
): Promise<Error> {
  const rawBody = await response.text();
  const bodyTail = redactSecrets(
    rawBody.trim().slice(-COMMAND_OUTPUT_TAIL_LIMIT),
    secrets,
  );
  const detail = bodyTail === "" ? "" : `: ${bodyTail}`;
  return new Error(
    `Worker metrics query returned HTTP ${String(response.status)}${detail}`,
  );
}

async function queryPrometheusWithRetry(
  expression: string,
  secrets: readonly string[],
  fetchImpl: FetchLike,
  delayMs: number,
): Promise<{ stdout: string; stderr: string }> {
  const url = new URL(
    "http://prometheus-kube-prometheus-prometheus.prometheus:9090/api/v1/query",
  );
  url.searchParams.set("query", expression);
  let lastError: unknown;
  for (let attempt = 1; attempt <= PROMETHEUS_QUERY_ATTEMPTS; attempt++) {
    try {
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) return { stdout: await response.text(), stderr: "" };
      lastError = await prometheusHttpFailure(response, secrets);
      if (response.status !== 429 && response.status < 500) throw lastError;
    } catch (error) {
      lastError = error;
      if (isNonRetryablePrometheusHttpError(error)) throw error;
    }
    if (attempt < PROMETHEUS_QUERY_ATTEMPTS) await Bun.sleep(delayMs * attempt);
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Worker metrics query failed");
}

function sanitizedChildEnv(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const childEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (key !== "OP_SERVICE_ACCOUNT_TOKEN" && value !== undefined)
      childEnv[key] = value;
  }
  return childEnv;
}

export async function runDeliveryJobCommand(
  argv: readonly string[],
  options: {
    env?: Readonly<Record<string, string | undefined>>;
    fetchImpl?: FetchLike;
    retryDelayMs?: number;
  } = {},
) {
  const env = options.env ?? Bun.env;
  const secrets = secretEnvironmentValues(env);
  if (argv[0] === "toolkit" && argv[1] === "prom" && argv[2] === "query") {
    const expression = z.string().min(1).parse(argv[3]);
    return await queryPrometheusWithRetry(
      expression,
      secrets,
      options.fetchImpl ?? fetch,
      options.retryDelayMs ?? PROMETHEUS_RETRY_DELAY_MS,
    );
  }
  const child = Bun.spawn([...argv], {
    stdout: "pipe",
    stderr: "pipe",
    env: sanitizedChildEnv(env),
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    const summary = redactSecrets(argv.slice(0, 5).join(" "), secrets);
    const combined = [stderr.trim(), stdout.trim()]
      .filter((part) => part !== "")
      .join("\n")
      .slice(-COMMAND_OUTPUT_TAIL_LIMIT);
    const sanitized = redactSecrets(combined, secrets);
    const detail = sanitized === "" ? "" : `: ${sanitized}`;
    throw new Error(
      `Reviewed worker proof or routing command failed (${summary}, exit ${String(exitCode)})${detail}`,
    );
  }
  return { stdout, stderr };
}

function command(argv: readonly string[]) {
  return runDeliveryJobCommand(argv);
}

async function main() {
  const raw = Bun.env["DELIVERY_JOB_REQUEST"];
  if (raw === undefined) throw new Error("Delivery Job input is missing");
  const request = DeliveryJobRequestSchema.parse(JSON.parse(raw));
  if (
    request.recipe === "platform-recovery" &&
    Bun.env["NODE_EXTRA_CA_CERTS"] === undefined
  ) {
    const ca = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt";
    if (!(await Bun.file(ca).exists()))
      throw new Error("Platform recovery requires its mounted Kubernetes CA");
    if (process.execve === undefined)
      throw new Error("Platform recovery requires process execve support");
    process.execve(
      process.execPath,
      [process.execPath, ...process.argv.slice(1)],
      {
        ...Bun.env,
        NODE_EXTRA_CA_CERTS: ca,
      },
    );
  }
  const checkout = await command(["git", "rev-parse", "HEAD"]);
  if (checkout.stdout.trim() !== request.sourceRevision)
    throw new Error(
      "Delivery Job checkout differs from qualified source revision",
    );
  const toplevel = await command(["git", "rev-parse", "--show-toplevel"]);
  // Worker candidates reuse or share this prepared checkout's objects and cache.
  const candidateCheckout = (snapshot: WorkerRolloutSnapshot) => ({
    sourceRevision: snapshot.deployment.workerSnapshot?.candidateBuildId,
    target: WorkerDeploymentRolloutTargetSchema.parse(
      snapshot.deployment.workerSnapshot?.target,
    ),
    executor: {
      root: toplevel.stdout.trim(),
      revision: request.sourceRevision,
    },
  });
  let result: unknown;
  switch (request.recipe) {
    case "worker-images": {
      const input = WorkerImageProofInputSchema.parse(request.input);
      await verifyDeliveryWorkerImages(input.detail, command);
      result = {
        verified: true,
        controlPlaneTemplates:
          input.controlPlane === null
            ? []
            : await renderControlPlaneTemplates(input.controlPlane, command),
      };
      break;
    }
    case "worker-preflight": {
      const { prepareDeliveryWorkerRollout } =
        await import("#lib/delivery/workers/worker-rollout.ts");
      const input = WorkerRoutingInputSchema.extend({
        connection: ConnectionSchema,
      }).parse(request.input);
      result = await withWorkerCandidateCheckout(
        candidateCheckout(input.detail),
        (candidate) =>
          prepareDeliveryWorkerRollout(
            input.detail,
            input.connection,
            command,
            { candidate, restored: input.restored },
          ),
      );
      break;
    }
    case "worker-step": {
      const { stepDeliveryWorkerRollout } =
        await import("#lib/delivery/workers/worker-rollout.ts");
      const input = WorkerRoutingInputSchema.extend({
        connection: ConnectionSchema,
        plan: WorkerRolloutPlanSchema,
        action: WorkerRolloutActionSchema,
      }).parse(request.input);
      result = await withWorkerCandidateCheckout(
        candidateCheckout(input.detail),
        (candidate) => stepDeliveryWorkerRollout(input, command, candidate),
      );
      break;
    }
    case "test": {
      result = await runTestStage(request);
      break;
    }
    case "tofu-apply": {
      const { run } = await import("./tofu-apply.ts");
      result = await run(request);
      break;
    }
    case "tofu-plan": {
      const { run } = await import("./tofu-plan.ts");
      result = await run(request);
      break;
    }
    case "control-plane": {
      const { run } = await import("./control-plane.ts");
      result = await run(request);
      break;
    }
    case "platform-recovery": {
      const { run } = await import("./platform-recovery.ts");
      result = await run(request);
      break;
    }
  }
  await Bun.write(
    Bun.stdout,
    `${DELIVERY_JOB_RESULT_PREFIX}${JSON.stringify(result)}\n`,
  );
}

if (import.meta.main) {
  await main();
}
