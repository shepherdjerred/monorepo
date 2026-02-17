import type { TServiceParams } from "@digital-alchemy/core";
import type { ByIdProxy, PICK_ENTITY } from "@digital-alchemy/hass";
import { match } from "ts-pattern";
import { DscVerificationError, TimeoutError } from "./errors.ts";
import { instrumentWorkflow } from "./metrics.ts";
import { Sentry } from "./sentry.ts";

export { TimeoutError } from "./errors.ts";

export type Time = {
  amount: number;
  unit?: "ms" | "s" | "m";
};

/**
 * Convert Time to milliseconds
 */
function timeToMs({ amount, unit = "ms" }: Time): number {
  return match(unit)
    .with("ms", () => amount)
    .with("s", () => amount * 1000)
    .with("m", () => amount * 60 * 1000)
    .exhaustive();
}

export function wait({ amount, unit = "ms" }: Time) {
  return new Promise((resolve) => setTimeout(resolve, timeToMs({ amount, unit })));
}

/**
 * Wrap a promise with a timeout. If the promise doesn't resolve/reject within
 * the specified time, it will reject with a TimeoutError.
 */
export function withTimeout<T>(promise: Promise<T>, timeout: Time, operationName?: string): Promise<T> {
  const timeoutMs = timeToMs(timeout);
  const operation = operationName ? ` for ${operationName}` : "";

  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => {
        reject(new TimeoutError(`Operation timeout after ${timeoutMs.toString()}ms${operation}`));
      }, timeoutMs),
    ),
  ]);
}

/**
 * Wrap a promise factory with a timeout. Useful for lazy evaluation.
 */
export function withTimeoutFactory<T>(
  promiseFactory: () => Promise<T>,
  timeout: Time,
  operationName?: string,
): () => Promise<T> {
  return () => withTimeout(promiseFactory(), timeout, operationName);
}

type DscCheckBase = {
  entityId: string;
  workflowName: string;
  getActualState: () => string;
  delay: Time;
  logger: TServiceParams["logger"];
  hass: TServiceParams["hass"];
};

type DscCheckExact = DscCheckBase & { check: string };
type DscCheckPredicate = DscCheckBase & { check: (actual: string) => boolean; description?: string };
type DscCheck = DscCheckExact | DscCheckPredicate;

function resolveDscCheck(check: DscCheck["check"], actual: string): boolean {
  return typeof check === "function" ? check(actual) : actual === check;
}

function describeDscCheck(opts: DscCheck): string {
  return typeof opts.check === "function" ? ("description" in opts ? (opts.description ?? "predicate") : "predicate") : opts.check;
}

export function verifyAfterDelay(opts: DscCheck): void {
  setTimeout(() => {
    void instrumentWorkflow(`dsc_${opts.workflowName}`, async () => {
      const actual = opts.getActualState();

      if (resolveDscCheck(opts.check, actual)) {
        opts.logger.info(`DSC passed: ${opts.entityId} state='${actual}'`);
        return;
      }

      const expected = describeDscCheck(opts);
      const error = new DscVerificationError(opts.entityId, expected, actual, opts.workflowName);
      opts.logger.error(error.message);

      Sentry.withScope((scope) => {
        scope.setTag("entity_id", opts.entityId);
        scope.setTag("workflow", opts.workflowName);
        scope.setContext("dsc", { entityId: opts.entityId, expected, actual, workflowName: opts.workflowName });
        Sentry.captureException(error);
      });

      await opts.hass.call.notify.notify({ title: "Device Verification Failed", message: error.message });
      throw error;
    });
  }, timeToMs(opts.delay));
}

export async function openCoversWithDelay(
  hass: TServiceParams["hass"],
  logger: TServiceParams["logger"],
  covers: PICK_ENTITY<"cover">[],
) {
  for (const cover of covers) {
    await withTimeout(
      hass.call.cover.open_cover({ entity_id: cover }),
      { amount: 30, unit: "s" },
      `open cover ${cover}`,
    );
    await wait({ amount: 1, unit: "s" });
  }

  for (const cover of covers) {
    verifyAfterDelay({
      entityId: cover,
      workflowName: "cover_open",
      getActualState: () => hass.refBy.id(cover).state,
      check: "open",
      delay: { amount: 60, unit: "s" },
      logger,
      hass,
    });
  }
}

export async function closeCoversWithDelay(
  hass: TServiceParams["hass"],
  logger: TServiceParams["logger"],
  covers: PICK_ENTITY<"cover">[],
) {
  for (const cover of covers) {
    await withTimeout(
      hass.call.cover.close_cover({ entity_id: cover }),
      { amount: 30, unit: "s" },
      `close cover ${cover}`,
    );
    await wait({ amount: 1, unit: "s" });
  }

  for (const cover of covers) {
    verifyAfterDelay({
      entityId: cover,
      workflowName: "cover_close",
      getActualState: () => hass.refBy.id(cover).state,
      check: "closed",
      delay: { amount: 60, unit: "s" },
      logger,
      hass,
    });
  }
}

export function isErrorState(state: ByIdProxy<"vacuum.roomba">["state"]) {
  return match(state)
    .with("error", () => true)
    .with("docked", () => false)
    .with("charging", () => false)
    .with("paused", () => false)
    .with("returning", () => false)
    .with("cleaning", () => false)
    .with("idle", () => false)
    .with("unavailable", () => false)
    .exhaustive();
}

export function shouldStartCleaning(state: ByIdProxy<"vacuum.roomba">["state"]) {
  return match(state)
    .with("error", () => false)
    .with("docked", () => true)
    .with("charging", () => true)
    .with("paused", () => true)
    .with("returning", () => true)
    .with("cleaning", () => false)
    .with("idle", () => true)
    .with("unavailable", () => false)
    .exhaustive();
}

export function shouldStopCleaning(state: ByIdProxy<"vacuum.roomba">["state"]) {
  return match(state)
    .with("error", () => false)
    .with("docked", () => false)
    .with("charging", () => false)
    .with("paused", () => true)
    .with("returning", () => false)
    .with("cleaning", () => true)
    .with("idle", () => true)
    .with("unavailable", () => false)
    .exhaustive();
}

export function startRoombaWithVerification(
  hass: TServiceParams["hass"],
  logger: TServiceParams["logger"],
  roomba: ByIdProxy<"vacuum.roomba">,
  options?: { delayMinutes?: number },
) {
  const delay = options?.delayMinutes ?? 3;

  verifyAfterDelay({
    entityId: "vacuum.roomba",
    workflowName: "roomba_start",
    getActualState: () => roomba.state,
    check: "cleaning",
    delay: { amount: delay, unit: "m" },
    logger,
    hass,
  });
}

export function runIf(condition: boolean, promiseFactory: () => Promise<unknown>): Promise<unknown> {
  if (condition) {
    return promiseFactory();
  }
  return Promise.resolve();
}

export function runParallel(promiseFactories: (() => Promise<unknown>)[]): Promise<unknown> {
  return Promise.all(promiseFactories.map((factory) => factory()));
}

export function runSequential(promiseFactories: (() => Promise<unknown>)[]): Promise<unknown> {
  let chain: Promise<unknown> = Promise.resolve();
  for (const factory of promiseFactories) {
    chain = chain.then(() => factory());
  }
  return chain;
}

export function runSequentialWithDelay(promiseFactories: (() => Promise<unknown>)[], delay: Time): Promise<unknown> {
  let chain: Promise<unknown> = Promise.resolve();
  for (const factory of promiseFactories) {
    chain = chain.then(() => factory()).then(() => wait(delay));
  }
  return chain;
}

export function repeat(promiseFactory: () => Promise<unknown>, times: number): (() => Promise<unknown>)[] {
  const factories: (() => Promise<unknown>)[] = [];
  for (let i = 0; i < times; i++) {
    factories.push(promiseFactory);
  }
  return factories;
}
