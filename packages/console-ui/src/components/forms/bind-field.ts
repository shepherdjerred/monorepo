import type { AnyFieldMeta } from "@tanstack/react-form";
import { z } from "zod";
import type { ErrorSummaryItem } from "@shepherdjerred/console-ui/components/forms/error-summary.tsx";

/**
 * TanStack Form + Zod binding. Pass a Zod schema as the form's
 * `validators.onChange` (Standard Schema); each field's `meta.errors` then
 * holds issue objects `{ message }`. These helpers read them for `Field`:
 *
 * ```tsx
 * <form.Field name="slug">
 *   {(field) => (
 *     <Field label="Short link" error={fieldErrorMessage(field.state.meta)}>
 *       {(control) => (
 *         <input
 *           {...control}
 *           name={field.name}
 *           value={field.state.value}
 *           onBlur={field.handleBlur}
 *           onChange={(event) => { field.handleChange(event.target.value); }}
 *         />
 *       )}
 *     </Field>
 *   )}
 * </form.Field>
 * ```
 */

/** The slice of a TanStack Form field's `state.meta` these helpers read. */
export type FieldMetaLike = Pick<AnyFieldMeta, "errors" | "isTouched">;

const ErrorSchema = z.union([
  z.string(),
  z.object({ message: z.string() }).transform((issue) => issue.message),
]);

function messageOf(error: unknown): string | undefined {
  const parsed = ErrorSchema.safeParse(error);
  return parsed.success ? parsed.data : undefined;
}

/**
 * The first error message of a field, once the field is touched (a failed
 * submit touches every field); `undefined` while it is valid or untouched.
 */
export function fieldErrorMessage(meta: FieldMetaLike): string | undefined {
  if (!meta.isTouched) return undefined;
  for (const error of meta.errors) {
    const message = messageOf(error);
    if (message !== undefined) return message;
  }
  return undefined;
}

/**
 * Entries for `ErrorSummary` from a form's `fieldMeta` (read it with
 * `useStore(form.store, (state) => state.fieldMeta)`). `fields` maps a field
 * name to its visible label and its control `id`.
 */
export function collectErrorSummary(
  fieldMeta: Readonly<Record<string, FieldMetaLike | undefined>>,
  fields: Readonly<
    Record<string, { readonly label: string; readonly fieldId: string }>
  >,
): ErrorSummaryItem[] {
  const items: ErrorSummaryItem[] = [];
  for (const [name, field] of Object.entries(fields)) {
    const meta = fieldMeta[name];
    const message = meta === undefined ? undefined : fieldErrorMessage(meta);
    if (message !== undefined) items.push({ ...field, message });
  }
  return items;
}
