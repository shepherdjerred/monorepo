import { z } from "zod/v4";
export function promotionLoginEmail(
  fields: { label: string; value?: string | undefined }[],
  label?: string,
): string | undefined {
  const field = fields.find((entry) =>
    label === undefined
      ? entry.label.toLowerCase() === "email"
      : entry.label === label,
  );
  if (field === undefined && label === undefined) return undefined;
  const result = z.email().safeParse(field?.value);
  if (!result.success) throw new Error("Mapped email missing or invalid");
  return result.data;
}
