import { z } from "zod";
export const ContentActionSchema = z.enum([
  "inspect",
  "repair",
  "inspect-prior",
]);
export type ContentOperatorAction = z.infer<typeof ContentActionSchema>;
export type ContentAction = Exclude<ContentOperatorAction, "inspect-prior">;
/** Only explicitly safe operator guidance is printed by the CLI error boundary. */
export class ContentOperatorError extends Error {}
