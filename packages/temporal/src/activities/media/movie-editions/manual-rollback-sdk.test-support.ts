import { Context } from "@temporalio/activity";
import { vi } from "vitest";
import { z } from "zod";
import type { createManualMovieRollbackFixture } from "@shepherdjerred/media/testing/movie-manual-rollback-workflow";
import { PublicationAuthorityReadBudget } from "@shepherdjerred/media/publication-authority-budget";
import { compensationCall } from "#activities/media/compensation-execution.ts";
import { plexBindingCall } from "#activities/media/plex-binding-execution.ts";

type Runtime = Awaited<
  ReturnType<typeof createManualMovieRollbackFixture>
>["manual"];
type Input = Parameters<Runtime["prepareRequestedMovieRollbackV1"]>[0];
type FileArgs = Parameters<Runtime["prepareRequestedMovieRollbackV1"]>;
type NetworkArgs = Parameters<Runtime["observeRequestedMovieRollbackV1"]>;
type InvocationTrace = {
  method: string;
  paid: number;
  reads: { count: number; source: string[] }[];
  fault: string | null;
};

/** Test-only delivery seam before production factory wiring: real current SDK
 * info/capability+one budget are captured BEFORE even the fixture load await. */
export function manualMovieRollbackWorkers(load: () => Promise<Runtime>) {
  const invocations: InvocationTrace[] = [];
  function measured(method: string) {
    const budget = new PublicationAuthorityReadBudget();
    const entry: InvocationTrace = {
      method,
      paid: 0,
      reads: new Array<{ count: number; source: string[] }>(),
      fault: null,
    };
    invocations.push(entry);
    const consume = budget.consume.bind(budget);
    const spy = vi.spyOn(budget, "consume").mockImplementation((count) => {
      entry.paid += count;
      entry.reads.push({
        count,
        source: (new Error("Manual original budget charge").stack ?? "")
          .split("\n")
          .filter((line) => line.includes("/packages/media/src/"))
          .slice(0, 2),
      });
      consume(count);
    });
    return { budget, entry, spy };
  }
  function file<T>(
    method: string,
    input: Input,
    dispatch: (runtime: Runtime, ...args: FileArgs) => Promise<T>,
  ) {
    const observed = { wall: Date.now(), monotonic: performance.now() };
    const invocation = measured(method);
    return compensationCall(async (sdk) => {
      const info = Context.current().info;
      if (info.workflowExecution === undefined)
        throw new Error(
          "Manual test requires its actual SDK Workflow Activity",
        );
      const owner = {
        workflowId: info.workflowExecution.workflowId,
        runId: info.workflowExecution.runId,
        activityId: info.activityId,
      };
      const runtime = await load();
      sdk.assertActive();
      try {
        return await dispatch(
          runtime,
          input,
          { ...sdk, observed, checkpoint: () => sdk.checkpoint(method) },
          owner,
          invocation.budget,
        );
      } catch (error) {
        invocation.entry.fault = safeFault(error);
        throw error;
      } finally {
        invocation.spy.mockRestore();
      }
    });
  }
  function network<T>(
    method: string,
    input: Input,
    dispatch: (runtime: Runtime, ...args: NetworkArgs) => Promise<T>,
  ) {
    const invocation = measured(method);
    return plexBindingCall(async (execution) => {
      const runtime = await load();
      execution.assertActive();
      try {
        return await dispatch(runtime, input, execution, invocation.budget);
      } catch (error) {
        invocation.entry.fault = safeFault(error);
        throw error;
      } finally {
        invocation.spy.mockRestore();
      }
    });
  }
  return {
    invocations,
    prepareRequestedMovieRollbackV1: (input: Input) =>
      file("prepareRequestedMovieRollbackV1", input, (runtime, ...args) =>
        runtime.prepareRequestedMovieRollbackV1(...args),
      ),
    rollbackRequestedMoviePublicationV1: (input: Input) =>
      file("rollbackRequestedMoviePublicationV1", input, (runtime, ...args) =>
        runtime.rollbackRequestedMoviePublicationV1(...args),
      ),
    observeRequestedMovieRollbackV1: (input: Input) =>
      network("observeRequestedMovieRollbackV1", input, (runtime, ...args) =>
        runtime.observeRequestedMovieRollbackV1(...args),
      ),
    verifyRequestedMovieRollbackV1: (input: Input) =>
      network("verifyRequestedMovieRollbackV1", input, (runtime, ...args) =>
        runtime.verifyRequestedMovieRollbackV1(...args),
      ),
  };
}

function safeFault(error: unknown) {
  if (error instanceof z.ZodError)
    return JSON.stringify({
      kind: "ZodError",
      issues: error.issues.map((issue) => ({
        path: issue.path,
        code: issue.code,
        expected: "expected" in issue ? issue.expected : undefined,
        keys: "keys" in issue ? issue.keys : undefined,
        received: /received ([a-z]+)/u.exec(issue.message)?.[1],
      })),
      source: (error.stack ?? "")
        .split("\n")
        .filter((line) => line.includes("/packages/media/src/"))
        .slice(0, 4),
    });
  if (!(error instanceof Error)) return "Unknown producer error";
  const driver = safeDriverFault(error);
  if (driver !== null) return JSON.stringify(driver);
  // Only static SQL guard text or the known budget message is exposed, never
  // the Prisma invocation, parameters, raw rows or arbitrary exception text.
  const text =
    /(?:Manual|Movie rollback|Pending movie rollback|Observed manual|Unknown manual|Admitted manual)[A-Za-z0-9 ,.'-]{1,240}/u.exec(
      error.message,
    )?.[0];
  return text ?? error.name;
}

function safeDriverFault(error: Error) {
  const parsed = z
    .object({
      cause: z.object({
        originalCode: z.string().regex(/^[A-Z0-9]{5}$/u),
        kind: z.string().regex(/^[A-Za-z]+$/u),
        originalMessage: z.string(),
      }),
    })
    .safeParse(error);
  if (!parsed.success) return null;
  const { originalCode, kind, originalMessage } = parsed.data.cause;
  // Whitelist static repo trigger labels and SQL type diagnostics only. Never
  // expose the Prisma query, bindings, row details, or arbitrary provider text.
  const constraintMessage =
    /^(?:Manual|Movie rollback|Pending movie rollback|Observed manual|Unknown manual|Admitted manual)[A-Za-z0-9 ,.'-]{1,240}$/u.test(
      originalMessage,
    )
      ? originalMessage
      : (/^(?:operator does not exist|column reference .* is ambiguous|record .* has no field|query returned no rows|query returned more than one row)[\w :.,"'-]{0,160}$/u.exec(
          originalMessage,
        )?.[0] ?? null);
  return { originalCode, kind, constraintMessage };
}
