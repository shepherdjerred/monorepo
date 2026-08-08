import { z } from "zod";

import { ValidationError } from "./errors";
import { PrioritySchema } from "./base-schemas";
import { CalendarDaySchema } from "./calendar-day";
import type { Priority } from "./priority";
import { err, ok, type Result } from "./result";

export const CaptureSeedSchema = z
  .object({
    version: z.literal(1),
    initialText: z.string(),
    scheduled: CalendarDaySchema.optional(),
    due: CalendarDaySchema.optional(),
    project: z.string().trim().min(1).optional(),
    priority: PrioritySchema.optional(),
  })
  .strict();

export type CaptureSeed = z.infer<typeof CaptureSeedSchema>;

const CaptureSeedRouteBoundarySchema = z
  .object({
    version: z.union([z.literal(1), z.literal("1")]).optional(),
    initialText: z.string().optional(),
    scheduled: z.string().optional(),
    due: z.string().optional(),
    project: z.string().optional(),
    priority: PrioritySchema.optional(),
  })
  .strict();

export type CaptureSeedRouteParams = {
  readonly version?: 1 | undefined;
  readonly initialText?: string | undefined;
  readonly scheduled?: string | undefined;
  readonly due?: string | undefined;
  readonly project?: string | undefined;
  readonly priority?: Priority | undefined;
};

export type CaptureSeedField = "scheduled" | "due" | "project" | "priority";

export type CaptureLiteralSource = {
  readonly sourceText: string;
  readonly occurrence: number;
};

export type CaptureSessionState = {
  readonly text: string;
  readonly literalSources: readonly CaptureLiteralSource[];
  readonly seed: CaptureSeed;
};

export function captureSeedFromInitialText(
  initialText: string | undefined,
): CaptureSeed {
  return createCaptureSeed({ initialText });
}

export function createCaptureSeed(
  params: CaptureSeedRouteParams = {},
): CaptureSeed {
  return CaptureSeedSchema.parse(captureSeedInput(params));
}

export function captureSeedFromRouteParams(
  params: unknown,
): Result<CaptureSeed, ValidationError> {
  const routeParams = CaptureSeedRouteBoundarySchema.safeParse(params ?? {});
  if (!routeParams.success) {
    return err(
      new ValidationError(
        "This Quick Add link contains invalid task details.",
        routeParams.error.issues,
      ),
    );
  }

  const seed = CaptureSeedSchema.safeParse(captureSeedInput(routeParams.data));
  if (!seed.success) {
    return err(
      new ValidationError(
        "This Quick Add link contains invalid task details.",
        seed.error.issues,
      ),
    );
  }

  return ok(seed.data);
}

export function clearCaptureSeedField(
  seed: CaptureSeed,
  field: CaptureSeedField,
): CaptureSeed {
  return createCaptureSeed({
    initialText: seed.initialText,
    ...(field === "scheduled" || seed.scheduled === undefined
      ? {}
      : { scheduled: seed.scheduled }),
    ...(field === "due" || seed.due === undefined ? {} : { due: seed.due }),
    ...(field === "project" || seed.project === undefined
      ? {}
      : { project: seed.project }),
    ...(field === "priority" || seed.priority === undefined
      ? {}
      : { priority: seed.priority }),
  });
}

export function setCaptureSeedProject(
  seed: CaptureSeed,
  project: string | undefined,
): CaptureSeed {
  return createCaptureSeed({
    initialText: seed.initialText,
    ...(seed.scheduled === undefined ? {} : { scheduled: seed.scheduled }),
    ...(seed.due === undefined ? {} : { due: seed.due }),
    ...(project === undefined ? {} : { project }),
    ...(seed.priority === undefined ? {} : { priority: seed.priority }),
  });
}

export function captureSessionFromSeed(seed: CaptureSeed): CaptureSessionState {
  return {
    text: seed.initialText,
    literalSources: [],
    seed,
  };
}

export function resetCaptureSessionForAnother(
  session: CaptureSessionState,
): CaptureSessionState {
  return {
    text: "",
    literalSources: [],
    seed: session.seed,
  };
}

type CaptureSeedInputParams = {
  readonly initialText?: string | undefined;
  readonly scheduled?: string | undefined;
  readonly due?: string | undefined;
  readonly project?: string | undefined;
  readonly priority?: Priority | undefined;
};

function captureSeedInput(params: CaptureSeedInputParams) {
  return {
    version: 1,
    initialText: params.initialText ?? "",
    ...(params.scheduled === undefined ? {} : { scheduled: params.scheduled }),
    ...(params.due === undefined ? {} : { due: params.due }),
    ...(params.project === undefined ? {} : { project: params.project }),
    ...(params.priority === undefined ? {} : { priority: params.priority }),
  };
}
