import { describe, expect, test } from "vitest";

import { dockerWorkspaceMounts } from "#src/host/docker.ts";

describe("dockerWorkspaceMounts", () => {
  test("keeps host Git metadata read-only inside the container", () => {
    expect(dockerWorkspaceMounts("/tmp/task")).toEqual([
      "--volume",
      "/tmp/task:/workspace",
      "--volume",
      "/tmp/task/.git:/workspace/.git:ro",
    ]);
  });
});
