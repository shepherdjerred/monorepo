import { z } from "zod";

/**
 * Language-neutral source of truth for limited-time queue availability windows
 * (`queue-windows.json`). Loaded and converted to the runtime
 * `QueueAvailability` shape by `queue-availability.ts`, and edited by the
 * queue-windows watcher (`packages/temporal` + backend `update-queue-windows`).
 *
 * Dates are calendar dates in UTC (`YYYY-MM-DD`), matching how the availability
 * model constructs `new Date("YYYY-MM-DD")`.
 */

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const DateOnlySchema = z
  .string()
  .regex(DATE_ONLY_REGEX, "expected a YYYY-MM-DD calendar date");

export const QueueWindowSourceSchema = z.enum(["manual", "observed"]);
export type QueueWindowSource = z.infer<typeof QueueWindowSourceSchema>;

export const QueueWindowSchema = z.strictObject({
  start: DateOnlySchema,
  /** null = open-ended: the mode is live with no announced end. */
  end: DateOnlySchema.nullable(),
  source: QueueWindowSourceSchema.default("manual"),
  note: z.string().optional(),
});
export type QueueWindow = z.infer<typeof QueueWindowSchema>;

export const QueueWindowsArraySchema = z
  .array(QueueWindowSchema)
  .superRefine((windows, ctx) => {
    for (const [index, window] of windows.entries()) {
      if (window.end !== null && window.end < window.start) {
        ctx.addIssue({
          code: "custom",
          message: `window ${index.toString()} ends (${window.end}) before it starts (${window.start})`,
          path: [index],
        });
      }
      if (index === 0) {
        continue;
      }
      const previous = windows[index - 1];
      if (previous === undefined) {
        continue;
      }
      if (window.start <= previous.start) {
        ctx.addIssue({
          code: "custom",
          message: `windows must be sorted ascending by start; window ${index.toString()} (${window.start}) is not after window ${(index - 1).toString()} (${previous.start})`,
          path: [index, "start"],
        });
      }
      if (previous.end === null) {
        ctx.addIssue({
          code: "custom",
          message: `only the last window may be open-ended, but window ${(index - 1).toString()} has end: null`,
          path: [index - 1, "end"],
        });
      } else if (previous.end >= window.start) {
        ctx.addIssue({
          code: "custom",
          message: `windows must not overlap; window ${(index - 1).toString()} ends (${previous.end}) on or after window ${index.toString()} starts (${window.start})`,
          path: [index, "start"],
        });
      }
    }
  });
export type QueueWindowsArray = z.infer<typeof QueueWindowsArraySchema>;

export const QueueWindowsFileSchema = z.strictObject({
  queues: z.record(z.string(), QueueWindowsArraySchema),
});
export type QueueWindowsFile = z.infer<typeof QueueWindowsFileSchema>;
