import { z } from "zod";

/** Request body text parsed as JSON; malformed JSON is a 400, not a 500. */
export const JsonTextSchema = z.string().transform((text, context): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    context.addIssue({ code: "custom", message: "Invalid JSON body" });
    return z.NEVER;
  }
});
