import type { z } from "zod";
import {
  type AmendExperimentSchema,
  type CreateExperimentSchema,
  type EditExperimentSchema,
  type EvidenceExperimentSchema,
  type Experiment,
  type ExperimentEvent,
  type ExperimentPlan,
  ExperimentPlanSchema,
  type ExperimentSummary,
  type LinkExperimentSchema,
  type ReviewExperimentSchema,
  type StartExperimentSchema,
} from "./contract.ts";

type CreateInput = z.infer<typeof CreateExperimentSchema>;
export type ExperimentCommand =
  | { kind: "edit"; input: z.infer<typeof EditExperimentSchema> }
  | { kind: "start"; input: z.infer<typeof StartExperimentSchema> }
  | { kind: "amend"; input: z.infer<typeof AmendExperimentSchema> }
  | { kind: "link"; input: z.infer<typeof LinkExperimentSchema> }
  | { kind: "evidence"; input: z.infer<typeof EvidenceExperimentSchema> }
  | { kind: "review"; input: z.infer<typeof ReviewExperimentSchema> };

export type ExperimentState = Omit<Experiment, "isDue" | "timeline">;
export type ExperimentMutation = {
  state: ExperimentState;
  event: ExperimentEvent;
};
export type ExperimentWriteContext = {
  actor: string;
  at: string;
  today: string;
};

export class ExperimentFailure extends Error {
  constructor(
    readonly status: 404 | 409 | 422,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const localDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function pacificDate(now: Date): string {
  return localDate.format(now);
}

export const emptyPlan: ExperimentPlan = {
  change: "",
  hypothesis: "",
  scope: "",
  successCriteria: "",
  measurementMethod: "",
  baseline: "",
  guardrails: "",
};

function applyPlan(
  current: ExperimentPlan,
  changes: Partial<Record<keyof ExperimentPlan, string | undefined>> = {},
): ExperimentPlan {
  const next = { ...current };
  for (const field of ExperimentPlanSchema.keyof().options) {
    const value = changes[field];
    if (value !== undefined) next[field] = value;
  }
  return next;
}

const requiredPlanFields = [
  ["change", "Proposed change"],
  ["hypothesis", "Hypothesis"],
  ["scope", "Affected scope"],
  ["successCriteria", "Success criteria"],
  ["measurementMethod", "Measurement method"],
] as const satisfies readonly (readonly [keyof ExperimentPlan, string])[];

function assertCompletePlan(plan: ExperimentPlan, reviewDate: string | null) {
  const fields: string[] = requiredPlanFields
    .filter(([field]) => plan[field] === "")
    .map(([, label]) => label);
  if (reviewDate === null) fields.push("Review date");
  if (fields.length > 0) {
    throw new ExperimentFailure(
      422,
      "incomplete_plan",
      `Complete ${fields.join(", ")}`,
    );
  }
}

type TimedExperiment = Pick<ExperimentState, "reviewDate" | "status">;

export function isDue(experiment: TimedExperiment, today: string): boolean {
  return (
    experiment.status === "running" &&
    experiment.reviewDate !== null &&
    experiment.reviewDate <= today
  );
}

export function summaryOf(
  state: ExperimentState,
  today: string,
): ExperimentSummary {
  const {
    plan: _plan,
    originalPlan: _originalPlan,
    originalReviewDate: _originalReviewDate,
    ...summary
  } = state;
  return { ...summary, isDue: isDue(state, today) };
}

export function createExperiment(
  id: string,
  input: CreateInput,
  actor: string,
  at: string,
): ExperimentMutation {
  return {
    state: {
      id,
      revision: 1,
      title: input.title,
      owner: input.owner,
      plan: applyPlan(emptyPlan, input.plan),
      originalPlan: null,
      reviewDate: input.reviewDate ?? null,
      originalReviewDate: null,
      status: "draft",
      decision: null,
      createdAt: at,
      updatedAt: at,
      startedAt: null,
      decidedAt: null,
    },
    event: { kind: "created", actor, at, revision: 1 },
  };
}

function requireStatus(
  actual: ExperimentState["status"],
  expected: ExperimentState["status"],
) {
  if (actual !== expected) {
    throw new ExperimentFailure(
      409,
      "invalid_state",
      `This action requires ${expected === "draft" ? "a draft" : "a running experiment"}`,
    );
  }
}

export function applyExperimentCommand(
  previous: ExperimentState,
  command: ExperimentCommand,
  { actor, at, today }: ExperimentWriteContext,
): ExperimentMutation {
  if (command.input.expectedRevision !== previous.revision) {
    throw revisionConflict();
  }
  const revision = previous.revision + 1;
  const state = { ...previous, revision, updatedAt: at };
  const entry = { actor, at, revision };
  switch (command.kind) {
    case "edit": {
      requireStatus(state.status, "draft");
      const { title, owner, plan, reviewDate } = command.input;
      return {
        state: {
          ...state,
          title: title ?? state.title,
          owner: owner ?? state.owner,
          plan: applyPlan(state.plan, plan),
          reviewDate: reviewDate === undefined ? state.reviewDate : reviewDate,
        },
        event: { ...entry, kind: "edited" },
      };
    }
    case "start":
      requireStatus(state.status, "draft");
      assertCompletePlan(state.plan, state.reviewDate);
      return {
        state: {
          ...state,
          status: "running",
          startedAt: at,
          originalPlan: state.plan,
          originalReviewDate: state.reviewDate,
        },
        event: { ...entry, kind: "started" },
      };
    case "amend": {
      requireStatus(state.status, "running");
      const plan = applyPlan(state.plan, command.input.plan);
      assertCompletePlan(plan, state.reviewDate);
      return {
        state: { ...state, plan },
        event: {
          ...entry,
          kind: "amendment",
          rationale: command.input.rationale,
          plan,
        },
      };
    }
    case "link":
      if (state.status === "decided") {
        throw new ExperimentFailure(
          409,
          "invalid_state",
          "Only draft and running experiments can gain links",
        );
      }
      return {
        state,
        event: { ...entry, kind: "link", link: command.input.link },
      };
    case "evidence": {
      requireStatus(state.status, "running");
      const { note, link, flagChange } = command.input;
      return {
        state,
        event: {
          ...entry,
          kind: "evidence",
          note,
          ...(link === undefined ? {} : { link }),
          ...(flagChange === undefined ? {} : { flagChange }),
        },
      };
    }
    case "review":
      return reviewExperiment(state, command.input, entry, today);
  }
}

function reviewExperiment(
  state: ExperimentState,
  { outcome, rationale, reviewDate }: z.infer<typeof ReviewExperimentSchema>,
  entry: Pick<ExperimentEvent, "actor" | "at" | "revision">,
  today: string,
): ExperimentMutation {
  requireStatus(state.status, "running");
  if (outcome === "extend") {
    if (
      reviewDate === undefined ||
      reviewDate <= today ||
      (state.reviewDate !== null && reviewDate <= state.reviewDate)
    ) {
      throw new ExperimentFailure(
        422,
        "invalid_review_date",
        "Choose a review date later than today and the current review date",
      );
    }
    return {
      state: { ...state, reviewDate },
      event: { ...entry, kind: "review", outcome, rationale, reviewDate },
    };
  }
  return {
    state: {
      ...state,
      status: "decided",
      decidedAt: entry.at,
      decision: outcome,
    },
    event: { ...entry, kind: "review", outcome, rationale },
  };
}

export function revisionConflict(): ExperimentFailure {
  return new ExperimentFailure(
    409,
    "revision_conflict",
    "The experiment changed. Reload it and retry with its current revision.",
  );
}
