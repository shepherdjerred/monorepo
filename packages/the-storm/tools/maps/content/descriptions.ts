import { z } from "zod";
import descriptions from "./descriptions.json";

const catalog = z
  .record(
    z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    z
      .string()
      .trim()
      .min(1)
      .refine((value) => value !== "null", "Author a map description"),
  )
  .parse(descriptions);

/** Authored import input, independent of missing or placeholder legacy metadata. */
export function mapDescription(id: string): string {
  const description = catalog[id];
  if (description === undefined) {
    throw new Error(
      `Missing authored map description for ${id}; add it to tools/maps/content/descriptions.json`,
    );
  }
  return description;
}
