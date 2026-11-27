import { expect } from "vitest";
import { z } from "zod";

const Manifest = z.looseObject({ kind: z.string() });

/** A prepared (inactive) chart renders exactly one ConfigMap: its marker. */
export function expectActivationMarkerOnly(resources: readonly unknown[]) {
  expect(resources).toHaveLength(1);
  expect(resources[0]).toMatchObject({
    kind: "ConfigMap",
    data: { active: "false" },
  });
}

/** The `kind` of every manifest a chart rendered. */
export function renderedKinds(resources: readonly unknown[]): string[] {
  return z
    .array(Manifest)
    .parse(resources)
    .map((manifest) => manifest.kind);
}
