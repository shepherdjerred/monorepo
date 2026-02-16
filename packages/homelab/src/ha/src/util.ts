import type { TServiceParams } from "@digital-alchemy/core";
import type { ByIdProxy, PICK_ENTITY } from "@digital-alchemy/hass";
import { match } from "ts-pattern";

export type Time = {
  amount: number;
  unit?: "ms" | "s" | "m";
};

/**
 * Custom error class for timeout failures
 */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

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
 *
 * @param promise - The promise to wrap
 * @param timeout - The timeout configuration
 * @param operationName - Optional name for the operation (used in error message)
 * @returns The result of the promise if it completes in time
 * @throws TimeoutError if the timeout is exceeded
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
 *
 * @param promiseFactory - Function that returns a promise
 * @param timeout - The timeout configuration
 * @param operationName - Optional name for the operation
 */
export function withTimeoutFactory<T>(
  promiseFactory: () => Promise<T>,
  timeout: Time,
  operationName?: string,
): () => Promise<T> {
  return () => withTimeout(promiseFactory(), timeout, operationName);
}

export async function openCoversWithDelay(hass: TServiceParams["hass"], covers: PICK_ENTITY<"cover">[]) {
  for (const cover of covers) {
    await withTimeout(
      hass.call.cover.open_cover({ entity_id: cover }),
      { amount: 30, unit: "s" },
      `open cover ${cover}`,
    );
    await wait({ amount: 1, unit: "s" });
  }
}

export async function closeCoversWithDelay(hass: TServiceParams["hass"], covers: PICK_ENTITY<"cover">[]) {
  for (const cover of covers) {
    await withTimeout(
      hass.call.cover.close_cover({ entity_id: cover }),
      { amount: 30, unit: "s" },
      `close cover ${cover}`,
    );
    await wait({ amount: 1, unit: "s" });
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
