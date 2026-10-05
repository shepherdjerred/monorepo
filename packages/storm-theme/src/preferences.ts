import { z } from "zod";
import { SeasonChoiceSchema } from "./catalog.ts";

export const PreferencesSchema = z
  .object({
    version: z.literal(1),
    appearance: z.enum(["system", "light", "dark"]),
    theme: SeasonChoiceSchema,
    effects: z.boolean(),
  })
  .strict();
export type StormPreferences = z.infer<typeof PreferencesSchema>;
export const defaultPreferences: StormPreferences = {
  version: 1,
  appearance: "system",
  theme: "auto",
  effects: true,
};
export const preferenceCookie = "storm_preferences";
export function readPreferences(cookie: string): StormPreferences | undefined {
  const encoded = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${preferenceCookie}=`))
    ?.slice(preferenceCookie.length + 1);
  if (encoded === undefined) return undefined;
  try {
    return PreferencesSchema.parse(JSON.parse(decodeURIComponent(encoded)));
  } catch {
    return undefined;
  } // A visitor's stale/malformed cookie is an external boundary.
}
