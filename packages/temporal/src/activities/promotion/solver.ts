import { z } from "zod/v4";
import {
  solverReservedMicrousd,
  updateSolverBudget,
  type PromotionStore,
} from "./store.ts";

const TaskResponseSchema = z.object({
  errorId: z.number().int(),
  taskId: z.number().int().positive().optional(),
  errorCode: z.string().optional(),
});
const ResultSchema = z.object({
  errorId: z.number().int(),
  status: z.enum(["processing", "ready"]).optional(),
  cost: z.coerce.number().nonnegative().optional(),
  errorCode: z.string().optional(),
  solution: z
    .object({
      gRecaptchaResponse: z.string().optional(),
      token: z.string().optional(),
      userAgent: z.string().optional(),
    })
    .optional(),
});

export type PromotionChallenge = {
  type: "RecaptchaV2TaskProxyless" | "TurnstileTaskProxyless";
  websiteURL: string;
  websiteKey: string;
  action?: string | undefined;
  cData?: string | undefined;
  chlPageData?: string | undefined;
};

/** Result tokens stay inside this Activity, never in Temporal input/output. */
export async function solvePromotionChallenge(input: {
  store: PromotionStore;
  occurrenceId: string;
  challenge: PromotionChallenge;
  apiKey: string;
  allowanceMicrousd: number;
  signal: AbortSignal;
  heartbeat: () => void;
  apply: (token: string, userAgent?: string) => Promise<void>;
  request?: (url: string, options: RequestInit) => Promise<Response>;
  registerSecret?: ((value: string) => void) | undefined;
}): Promise<{ taskId: number; costMicrousd: number }> {
  const request = input.request ?? fetch;
  const month = new Date().toISOString().slice(0, 7);
  const reservationId = crypto.randomUUID();
  // $0.01 covers supported task types at the configured provider bid. Unknown
  // task-creation outcomes retain their reservation, including across restarts.
  const reservation = 10_000;
  await updateSolverBudget(input.store, month, (budget) => {
    if (
      Object.values(budget.charges).filter(
        (charge) => charge.occurrenceId === input.occurrenceId,
      ).length >= 2
    )
      throw new Error(
        "Two CAPTCHA attempts already reserved for this occurrence",
      );
    if (solverReservedMicrousd(budget) + reservation > input.allowanceMicrousd)
      throw new Error("Monthly Anti-Captcha allowance exhausted");
    return {
      ...budget,
      charges: {
        ...budget.charges,
        [reservationId]: {
          occurrenceId: input.occurrenceId,
          taskId: null,
          reservedMicrousd: reservation,
          chargedMicrousd: null,
        },
      },
    };
  });
  const post = async (method: string, parameters: Record<string, unknown>) => {
    const response = await request(`https://api.anti-captcha.com/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientKey: input.apiKey, ...parameters }),
      signal: AbortSignal.any([input.signal, AbortSignal.timeout(30_000)]),
    });
    if (!response.ok)
      throw new Error(`Anti-Captcha HTTP ${String(response.status)}`);
    const data: unknown = await response.json();
    return data;
  };
  const task = TaskResponseSchema.parse(
    await post("createTask", { task: input.challenge }),
  );
  if (task.errorId !== 0 || task.taskId === undefined)
    throw new Error(
      `Anti-Captcha creation failed: ${task.errorCode ?? "missing task ID"}`,
    );
  const taskId = task.taskId;
  await updateSolverBudget(input.store, month, (budget) => {
    const charge = budget.charges[reservationId];
    if (charge === undefined) throw new Error("Solver reservation disappeared");
    return {
      ...budget,
      charges: { ...budget.charges, [reservationId]: { ...charge, taskId } },
    };
  });
  for (let poll = 0; poll < 24; poll++) {
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(new Error("CAPTCHA solve cancelled"));
      };
      const timer = setTimeout(() => {
        input.signal.removeEventListener("abort", abort);
        resolve();
      }, 5000);
      if (input.signal.aborted) abort();
      else input.signal.addEventListener("abort", abort, { once: true });
    });
    input.heartbeat();
    const result = ResultSchema.parse(await post("getTaskResult", { taskId }));
    if (result.errorId !== 0)
      throw new Error(
        `Anti-Captcha solve failed: ${result.errorCode ?? "unknown"}`,
      );
    if (result.status !== "ready") continue;
    const token = result.solution?.gRecaptchaResponse ?? result.solution?.token;
    if (token === undefined || result.cost === undefined)
      throw new Error("Anti-Captcha result omitted solution or cost");
    const costMicrousd = Math.ceil(result.cost * 1_000_000);
    await updateSolverBudget(input.store, month, (budget) => {
      const charge = budget.charges[reservationId];
      if (charge === undefined)
        throw new Error("Solver reservation disappeared");
      return {
        ...budget,
        charges: {
          ...budget.charges,
          [reservationId]: { ...charge, chargedMicrousd: costMicrousd },
        },
      };
    });
    input.registerSecret?.(token);
    await input.apply(token, result.solution?.userAgent);
    return { taskId, costMicrousd };
  }
  throw new Error(
    "Anti-Captcha task did not settle within two minutes; reservation retained",
  );
}
