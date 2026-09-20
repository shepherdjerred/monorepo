import { z } from "zod";

import { InstantTextSchema } from "#shared/time";

/**
 * The incident this script was written for. Kept as the default so the
 * reviewed command in README.md keeps selecting exactly what it documents:
 * widening the blast radius of an existing runbook by omission is how an
 * operator cancels notifications they never meant to touch.
 */
const DEFAULT_ALERTNAME = "TemporalWorkflowFailed";

export const CancelIncidentArgsSchema = z
  .object({
    database: z.string().startsWith("file:"),
    alertname: z.string().min(1).default(DEFAULT_ALERTNAME),
    // Every pending row in the window, including rows carrying no occurrences
    // at all — which no alertname can select, and which nothing else can ever
    // clear. Opt in explicitly; it cancels unrelated alerts too.
    allAlertnames: z.boolean(),
    from: InstantTextSchema,
    to: InstantTextSchema,
    operator: z.string().min(1),
    reason: z.string().min(10),
    confirm: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.allAlertnames && value.alertname !== DEFAULT_ALERTNAME) {
      context.addIssue({
        code: "custom",
        message: "--all-alertnames cannot be combined with --alertname",
      });
    }
  });
