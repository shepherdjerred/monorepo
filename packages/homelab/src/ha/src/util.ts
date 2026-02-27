import type { TServiceParams } from "@digital-alchemy/core";
import type { ByIdProxy, PICK_ENTITY } from "@digital-alchemy/hass";
import { match } from "ts-pattern";
import { DscVerificationError, TimeoutError } from "./errors.ts";
import { instrumentWorkflow } from "./metrics.ts";
import { Sentry } from "./sentry.ts";

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
  return new Promise((resolve) =>
    setTimeout(resolve, timeToMs({ amount, unit })),
  );
}

/**
 * Wrap a promise with a timeout. If the promise doesn't resolve/reject within
 * the specified time, it will reject with a TimeoutError.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeout: Time,
  operationName?: string,
): Promise<T> {
  const timeoutMs = timeToMs(timeout);
  const operation = operationName === undefined ? "" : ` for ${operationName}`;

  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => {
        reject(
          new TimeoutError(
            `Operation timeout after ${timeoutMs.toString()}ms${operation}`,
          ),
        );
      }, timeoutMs),
    ),
  ]);
}

type DscCheckBase = {
  entityId: string;
  workflowName: string;
  getActualState: () => string;
  delay: Time;
  logger: TServiceParams["logger"];
  hass: TServiceParams["hass"];
  retries?: number;
  retryDelay?: Time;
};

type DscCheckExact = DscCheckBase & { check: string };
type DscCheckPredicate = DscCheckBase & {
  check: (actual: string) => boolean;
  description?: string;
};
type DscCheck = DscCheckExact | DscCheckPredicate;

function resolveDscCheck(check: DscCheck["check"], actual: string): boolean {
  return typeof check === "function" ? check(actual) : actual === check;
}

function describeDscCheck(opts: DscCheck): string {
  if (typeof opts.check === "function") {
    return "description" in opts
      ? (opts.description ?? "predicate")
      : "predicate";
  }
  return opts.check;
}

export function verifyAfterDelay(opts: DscCheck): void {
  const maxAttempts = (opts.retries ?? 0) + 1;
  const retryDelayTime = opts.retryDelay ?? { amount: 30, unit: "s" as const };

  setTimeout(() => {
    void instrumentWorkflow(`dsc_${opts.workflowName}`, async () => {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const actual = opts.getActualState();

        if (resolveDscCheck(opts.check, actual)) {
          opts.logger.info(`DSC passed: ${opts.entityId} state='${actual}'`);
          return;
        }

        if (attempt < maxAttempts) {
          opts.logger.info(
            `DSC check ${opts.entityId} attempt ${attempt.toString()}/${maxAttempts.toString()} failed (state='${actual}'), retrying in ${timeToMs(retryDelayTime).toString()}ms`,
          );
          await wait(retryDelayTime);
          continue;
        }

        const expected = describeDscCheck(opts);
        const error = new DscVerificationError(
          opts.entityId,
          expected,
          actual,
          opts.workflowName,
        );
        opts.logger.error(error.message);

        Sentry.withScope((scope) => {
          scope.setTag("entity_id", opts.entityId);
          scope.setTag("workflow", opts.workflowName);
          scope.setContext("dsc", {
            entityId: opts.entityId,
            expected,
            actual,
            workflowName: opts.workflowName,
          });
          Sentry.captureException(error);
        });

        await opts.hass.call.notify.notify({
          title: "Device Verification Failed",
          message: error.message,
        });
        throw error;
      }
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

export function shouldStartCleaning(
  state: ByIdProxy<"vacuum.roomba">["state"],
) {
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
    retries: 3,
    retryDelay: { amount: 1, unit: "m" },
    logger,
    hass,
  });
}

/**
 * Wraps a media object as the `media` parameter for `play_media`.
 *
 * The generated types from @digital-alchemy/type-writer incorrectly declare
 * `media` as `string`, but Home Assistant expects an object with
 * `media_content_id` and `media_content_type`. Passing a JSON string causes
 * HA's `_promote_media_fields()` to skip field promotion, failing schema
 * validation and leaving the websocket promise permanently pending.
 */
export function mediaParam(media: {
  media_content_id: string;
  media_content_type: string;
}): string {
  // @ts-expect-error HA expects object but generated types say string
  return media;
}

export function runIf(
  condition: boolean,
  promiseFactory: () => Promise<unknown>,
): Promise<unknown> {
  if (condition) {
    return promiseFactory();
  }
  return Promise.resolve();
}

export function runParallel(
  promiseFactories: (() => Promise<unknown>)[],
): Promise<unknown> {
  return Promise.all(promiseFactories.map((factory) => factory()));
}

export async function runSequential(
  promiseFactories: (() => Promise<unknown>)[],
): Promise<void> {
  for (const factory of promiseFactories) {
    await factory();
  }
}

export async function runSequentialWithDelay(
  promiseFactories: (() => Promise<unknown>)[],
  delay: Time,
): Promise<void> {
  for (const factory of promiseFactories) {
    await factory();
    await wait(delay);
  }
}

export function repeat(
  promiseFactory: () => Promise<unknown>,
  times: number,
): (() => Promise<unknown>)[] {
  const factories: (() => Promise<unknown>)[] = [];
  for (let i = 0; i < times; i++) {
    factories.push(promiseFactory);
  }
  return factories;
}

/**
 * Check if anyone is home by checking person entity states.
 */
export function isAnyoneHome(hass: TServiceParams["hass"]): boolean {
  const personJerred = hass.refBy.id("person.jerred");
  const personShuxin = hass.refBy.id("person.shuxin");
  return personJerred.state === "home" || personShuxin.state === "home";
}
