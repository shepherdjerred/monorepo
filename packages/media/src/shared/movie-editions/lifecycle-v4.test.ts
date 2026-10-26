import { expect, test } from "vitest";
import { MovieRequestV3Schema } from "./commands.ts";
import { DefaultCommandV2Schema } from "#shared/editions/commands.ts";
import { MovieEditionKeySchema } from "./registry.ts";
import {
  MovieRequestV4Schema,
  MovieLifecycleCommandV4Schema,
} from "./lifecycle-v4.ts";

const mediaId = "10000000-0000-4000-8000-000000000001";
const subjectUserId = "10000000-0000-4000-8000-000000000002";
const request = {
  schemaVersion: 3,
  mediaId,
  subjectUserId,
  expected: {
    mediaVersion: 2,
    targetVersion: null,
    definition: null,
    request: null,
  },
  selection: {
    edition: "directors_cut",
    definitionVersion: 0,
    definitionDigest: "a".repeat(64),
    registryVersion: 1,
  },
  options: { subtitleLanguages: ["en", "zh-Hans"] },
};

test("v4 movie requests keep an explicit selection and cannot be mistaken for v3", () => {
  const historical = MovieRequestV3Schema.parse(request);
  const literal = JSON.stringify(historical);
  const v4 = { ...request, schemaVersion: 4 };
  expect(MovieRequestV4Schema.parse(v4)).toEqual(v4);
  expect(MovieRequestV3Schema.safeParse(v4).success).toBe(false);
  expect(MovieRequestV4Schema.safeParse(request).success).toBe(false);
  const { selection: _selection, ...missingChoice } = v4;
  expect(MovieRequestV4Schema.safeParse(missingChoice).success).toBe(false);
  expect(JSON.stringify(historical)).toBe(literal);
});

test.each(MovieEditionKeySchema.options)(
  "v4 lifecycle commands retain exact %s scope and target CAS",
  (edition) => {
    const command = {
      schemaVersion: 4,
      scope: { rootMediaId: mediaId, mediaId, edition },
      expected: { mediaVersion: 2, targetVersion: 5 },
      command: { action: "keep" },
    };
    expect(MovieLifecycleCommandV4Schema.parse(command)).toEqual(command);
    expect(DefaultCommandV2Schema.safeParse(command).success).toBe(false);
    expect(
      MovieLifecycleCommandV4Schema.safeParse({
        ...command,
        scope: { ...command.scope, rootMediaId: subjectUserId },
      }).success,
    ).toBe(false);
    expect(
      MovieLifecycleCommandV4Schema.safeParse({
        ...command,
        expected: { mediaVersion: 2, targetVersion: null },
      }).success,
    ).toBe(false);
    expect(
      MovieLifecycleCommandV4Schema.safeParse({
        ...command,
        edition: "default",
      }).success,
    ).toBe(false);
  },
);

test("removal confirmation from another edition cannot authorize the requested scope", () => {
  const scope = { rootMediaId: mediaId, mediaId, edition: "directors_cut" };
  const confirmation = {
    scope,
    fileSetHash: "b".repeat(64),
    assets: [
      { assetId: subjectUserId, assetVersion: 3, checksum: "c".repeat(64) },
    ],
  };
  const input = {
    schemaVersion: 4,
    scope,
    expected: { mediaVersion: 2, targetVersion: 5 },
    command: { action: "remove", confirmation },
  };
  expect(MovieLifecycleCommandV4Schema.parse(input)).toEqual(input);
  expect(
    MovieLifecycleCommandV4Schema.safeParse({
      ...input,
      command: {
        action: "remove",
        confirmation: {
          ...confirmation,
          scope: { ...scope, edition: "extended_cut" },
        },
      },
    }).success,
  ).toBe(false);
  expect(
    MovieLifecycleCommandV4Schema.safeParse({
      ...input,
      command: { action: "remove" },
    }).success,
  ).toBe(false);
});
