// Zod schemas for runtime validation
import { z } from "zod";

// Individual Zod schemas for type detection
export const StringSchema = z.string();
export const ActualNumberSchema = z.number(); // Runtime number
export const ActualBooleanSchema = z.boolean(); // Runtime boolean
export const NullSchema = z.null();
export const UndefinedSchema = z.undefined();
export const ArraySchema = z.array(z.unknown());
export const RecordSchema = z.record(z.string(), z.unknown());
export const ErrorSchema = z.instanceof(Error);

// Custom boolean string parser - only matches actual boolean-like strings
export const StringBooleanSchema = z.string().refine((val) => {
  const lower = val.toLowerCase();
  return lower === "true" || lower === "false" || lower === "yes" || lower === "no";
}, "Not a boolean string");

// Zod schema for validating YAML values - recursive definition with more flexibility
export const HelmValueSchema: z.ZodType<Record<string, unknown>> = z.lazy(() =>
  z.record(
    z.string(),
    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.undefined(),
      z.array(z.unknown()), // Allow arrays of any type
      HelmValueSchema,
      z.unknown(), // Allow any other values as fallback
    ]),
  ),
);

export type HelmValue = z.infer<typeof HelmValueSchema>;
