import { z } from "zod";

export const JsonPathSchema = z
  .array(
    z.union([
      z.string().min(1).max(200),
      z.number().int().nonnegative(),
      z.strictObject({ arrayElements: z.literal(true) }),
    ]),
  )
  .max(32);
type Json = z.infer<ReturnType<typeof z.json>>;
type Selected = {
  path: string;
  present: boolean;
  value: Json | null;
  type: string;
};
const missing = (path: string): Selected => ({
  path,
  present: false,
  value: null,
  type: "missing",
});
const observed = (path: string, value: Json): Selected => ({
  path,
  present: true,
  value,
  type: jsonType(value),
});

function selectProperty(entry: Selected, step: string | number): Selected {
  const { value, present } = entry;
  const path = `${entry.path}[${JSON.stringify(step)}]`;
  return !present ||
    value === null ||
    typeof value !== "object" ||
    !Object.hasOwn(value, String(step))
    ? missing(path)
    : observed(path, z.json().parse(Reflect.get(value, String(step))));
}

function expandArray(entry: Selected): Selected[] {
  return !entry.present || !Array.isArray(entry.value)
    ? [missing(`${entry.path}[]`)]
    : entry.value.map((value, index) =>
        observed(`${entry.path}[${index.toString()}]`, value),
      );
}

/** Closed selectors over already validated JSON; no expressions or coercion. */
export function selectJsonValues(
  data: Json,
  path: z.infer<typeof JsonPathSchema>,
): Selected[] {
  let selected: Selected[] = [observed("$", data)];
  for (const step of path)
    selected = selected.flatMap((entry) =>
      typeof step === "object"
        ? expandArray(entry)
        : [selectProperty(entry, step)],
    );
  return selected;
}

function jsonType(value: Json): string {
  return value === null
    ? "null"
    : Array.isArray(value)
      ? "array"
      : typeof value;
}
