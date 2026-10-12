import { z } from "zod";
const TokenSchema = z.object({
  text: z.string(),
  color: z.string(),
  start: z.number().int().nonnegative(),
});
const LineSchema = z.object({
  id: z.number().int().nonnegative(),
  text: z.string(),
  tokens: z.array(TokenSchema),
});
const HoverSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  info: z.number().int().nonnegative(),
});
const FocusSchema = z.object({
  line: z.number().int().positive(),
  columns: z
    .tuple([z.number().int().positive(), z.number().int().positive()])
    .optional(),
});
const CodeStateSchema = z.object({
  kind: z.literal("code"),
  lines: z.array(z.number().int().nonnegative()).min(1),
  focus: z.array(FocusSchema),
  hovers: z.record(z.coerce.number(), z.array(HoverSchema)),
});
const ImageStateSchema = z.object({
  kind: z.literal("image"),
  src: z.string(),
  alt: z.string(),
});
export const WaveDataSchema = z.object({
  lines: z.array(LineSchema),
  states: z
    .array(z.discriminatedUnion("kind", [CodeStateSchema, ImageStateSchema]))
    .min(1),
  hovers: z.array(z.string()),
});
