import { z } from "zod";

/**
 * The editable shape of the bet form: side + stake as the user typed them.
 * Native constraints own required/min/step; this schema owns the cross-field
 * rule the browser cannot express — the stake must fit the freshest balance —
 * and the integer coercion of the text input.
 */
export function bucksStakeFormSchema(balance: number) {
  return z.object({
    side: z.string().min(1, "Pick a side"),
    stake: z
      .string()
      .trim()
      .min(1, "Enter a stake")
      .transform((value, context) => {
        const parsed = Number(value);
        if (!Number.isSafeInteger(parsed) || parsed < 1) {
          context.addIssue({
            code: "custom",
            message: "Stake must be a whole number of at least 1 BB",
          });
          return z.NEVER;
        }
        return parsed;
      })
      .superRefine((stake, context) => {
        if (stake > balance) {
          context.addIssue({
            code: "custom",
            message: `Stake exceeds your ${balance.toString()} BB balance`,
          });
        }
      }),
  });
}

export type BucksStakeFormValues = { side: string; stake: string };

export const BucksContributionFormSchema = z.object({
  contributionAmount: z
    .string()
    .trim()
    .min(1, "Enter a contribution")
    .transform((value, context) => {
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed < 1) {
        context.addIssue({
          code: "custom",
          message: "Contribution must be a whole number of at least 1 BB",
        });
        return z.NEVER;
      }
      return parsed;
    }),
});

export const BUCKS_QUICK_STAKES = [1, 5] as const;
