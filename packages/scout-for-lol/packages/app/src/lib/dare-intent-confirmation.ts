import { z } from "zod";

export type DareIntentAction =
  "fund" | "accept" | "decline" | "contribute" | "cancel";

export type DareIntentConfirmationOutcome = {
  status: "confirmed" | "failed";
  message: string;
  retryable: boolean;
};

const KindResultSchema = z.looseObject({ kind: z.string() });
const NestedResultSchema = z.looseObject({ result: z.unknown() });

function kindOf(value: unknown): string | null {
  return KindResultSchema.safeParse(value).data?.kind ?? null;
}

function expectedKind(action: DareIntentAction): string {
  switch (action) {
    case "fund":
      return "funded";
    case "accept":
      return "accepted";
    case "decline":
      return "declined";
    case "contribute":
      return "contributed";
    case "cancel":
      return "cancelled";
  }
}

function nestedResult(value: unknown): unknown {
  return NestedResultSchema.safeParse(value).data?.result ?? null;
}

export function classifyDareIntentConfirmation(
  action: DareIntentAction,
  result: unknown,
): DareIntentConfirmationOutcome {
  const kind = kindOf(result);
  const expected = expectedKind(action);
  if (kind === expected) {
    return {
      status: "confirmed",
      message: kind.replaceAll("_", " "),
      retryable: false,
    };
  }
  if (
    kind === "already_consumed" &&
    kindOf(nestedResult(result)) === expected
  ) {
    return {
      status: "confirmed",
      message: `${expected.replaceAll("_", " ")} earlier`,
      retryable: false,
    };
  }
  const failureKind = kind ?? "invalid result";
  return {
    status: "failed",
    message: failureKind.replaceAll("_", " "),
    retryable: kind === "insufficient" || kind === "feature_disabled",
  };
}
