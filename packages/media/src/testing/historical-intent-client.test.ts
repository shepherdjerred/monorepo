import { expect, test } from "vitest";
import { Prisma as Current } from "#generated/prisma/client.ts";
import { Prisma as Historical } from "#generated/prisma-historical-intent/client.ts";

const artwork = ["posterPath", "backdropPath", "overview", "artworkObservedAt"];

function scalarFields(namespace: object): Map<string, string[]> {
  const fields = new Map<string, string[]>();
  for (const [name, value] of Object.entries(namespace))
    if (
      value !== null &&
      typeof value === "object" &&
      name.endsWith("ScalarFieldEnum")
    )
      fields.set(name, Object.keys(value));
  return fields;
}

test("the pre-038 fixture client never reads artwork columns its schemas lack", () => {
  expect(Object.keys(Current.MediaItemScalarFieldEnum)).toEqual(
    expect.arrayContaining(artwork),
  );
  for (const name of artwork)
    expect(Object.keys(Historical.MediaItemScalarFieldEnum)).not.toContain(
      name,
    );
});

// scripts/generate.ts drops historical fields by name across the whole schema,
// so an artwork name reused on another model would silently vanish from the
// historical client there as well.
test("artwork column names belong to MediaItem alone", () => {
  const current = scalarFields(Current);
  expect(current.size).toBeGreaterThan(1);
  for (const [model, fields] of current) {
    if (model === "MediaItemScalarFieldEnum") continue;
    for (const name of artwork) expect(fields, model).not.toContain(name);
  }
});
