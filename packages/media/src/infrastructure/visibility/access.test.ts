import { expect, test } from "vitest";
import { captureVisibilityPlexAccess } from "./access.ts";

test("TV captures only its requested configuration and never needs movie settings", async () => {
  const requested: string[] = [];
  const settings = {
    serverMachineId: "fixture-server",
    plexAccess: (kind: "movie" | "show") => {
      requested.push(kind);
      if (kind !== "show")
        throw new Error("Movie section intentionally unconfigured");
      return Promise.resolve({
        serverMachineId: "fixture-server",
        sectionId: "2",
        sectionType: kind,
      });
    },
  };
  expect(await captureVisibilityPlexAccess(settings, "episode")).toEqual({
    serverMachineId: "fixture-server",
    sectionId: "2",
    sectionType: "show",
  });
  expect(requested).toEqual(["show"]);
});

test("configuration is captured anew and neither missing nor mismatched authority falls back", async () => {
  let sectionId = "1";
  const settings = {
    serverMachineId: "fixture-server",
    plexAccess: (sectionType: "movie" | "show") =>
      Promise.resolve({
        serverMachineId: "fixture-server",
        sectionId,
        sectionType,
      }),
  };
  const first = await captureVisibilityPlexAccess(settings, "movie");
  sectionId = "3";
  const second = await captureVisibilityPlexAccess(settings, "movie");
  expect(first.sectionId).toBe("1");
  expect(second.sectionId).toBe("3");
  await expect(
    captureVisibilityPlexAccess(
      { serverMachineId: "fixture-server", movieSectionId: "1" },
      "episode",
    ),
  ).rejects.toMatchObject({ code: "plex_scope_unconfigured" });
  await expect(
    captureVisibilityPlexAccess(
      {
        serverMachineId: "fixture-server",
        plexAccess: () =>
          Promise.resolve({
            serverMachineId: "other-server",
            sectionId: "2",
            sectionType: "show",
          }),
      },
      "episode",
    ),
  ).rejects.toThrow("different server or kind");
});
