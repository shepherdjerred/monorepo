import { z } from "zod";
export const ContentActionSchema = z.enum(["inspect", "repair"]);
export type ContentAction = z.infer<typeof ContentActionSchema>;
/** Only explicitly safe operator guidance is printed by the CLI error boundary. */
export class ContentOperatorError extends Error {}
