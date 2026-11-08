import { expect, test } from "bun:test";
import {
  directEmptyLinkControllerCount,
  directSingleResourceLifetime,
  compileDirectEmptySingleResourceProgram,
} from "./latest-direct-effect-link-controllers.mjs";

test("original absent and exactly empty material override vectors project to zero link controllers", () => {
  expect(directEmptyLinkControllerCount({})).toBe(0);
  expect(
    directEmptyLinkControllerCount({ materialOverrideDefinitions: [] }),
  ).toBe(0);
  expect(
    directEmptyLinkControllerCount({
      emitterName: "arbitrary",
      materialOverrideDefinitions: [],
    }),
  ).toBe(0);
});
test("single resource lifetime uses strict f32 max+10, preserves the -1 sentinel and requires empty overrides", () => {
  const input = {
    lifetime: 10.5,
    particleLifetimeMaximum: 0.5,
    isSingleParticle: true,
    materialOverrideCount: 0,
  };
  expect(directSingleResourceLifetime(input).effectiveLifetime).toBe(10.5);
  expect(
    directSingleResourceLifetime({ ...input, lifetime: 10.500000953674316 })
      .effectiveLifetime,
  ).toBe(0.5);
  expect(
    directSingleResourceLifetime({
      ...input,
      lifetime: 100,
      materialOverrideCount: 1,
    }).effectiveLifetime,
  ).toBe(100);
  expect(
    directSingleResourceLifetime({
      ...input,
      lifetime: 100,
      isSingleParticle: false,
    }).effectiveLifetime,
  ).toBe(100);
  expect(
    directSingleResourceLifetime({
      ...input,
      lifetime: 100,
      particleLifetimeMaximum: -1,
    }).effectiveLifetime,
  ).toBe(100);
  const source = {
    particleLifetime: { __type: "ValueFloat", constantValue: 0.5 },
    isSingleParticle: true,
  };
  expect(
    compileDirectEmptySingleResourceProgram(source, "camera-quad")
      .effectiveLifetime,
  ).toBe(0.5);
  expect(Object.hasOwn(source, "lifetime")).toBe(false);
  expect(
    compileDirectEmptySingleResourceProgram(
      { ...source, materialOverrideDefinitions: [null] },
      "camera-quad",
    ),
  ).toBeNull();
});
test("unresolved or malformed override vectors never become an empty link", () => {
  for (const value of [undefined, null, {}, 0, false, "", [null], new Array(1)])
    expect(
      directEmptyLinkControllerCount({ materialOverrideDefinitions: value }),
    ).toBeNull();
  const extra = [];
  extra.foreign = true;
  expect(
    directEmptyLinkControllerCount({ materialOverrideDefinitions: extra }),
  ).toBeNull();
  expect(
    directEmptyLinkControllerCount(
      Object.create({ materialOverrideDefinitions: [] }),
    ),
  ).toBeNull();
  for (const value of [null, [], 0, ""])
    expect(directEmptyLinkControllerCount(value)).toBeNull();
});
