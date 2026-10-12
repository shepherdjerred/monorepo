import { describe, expect, it } from "vitest";
import { paperJarName } from "#sandbox/artifacts.ts";
import { basePaperEnv } from "#sandbox/paper-env.ts";
import { paper } from "#src/pins.ts";

describe("basePaperEnv", () => {
  it("runs a seeded jar as a custom server so boot never resolves Paper online", () => {
    const env = basePaperEnv("seeded");
    expect(env["TYPE"]).toBe("CUSTOM");
    expect(env["CUSTOM_SERVER"]).toBe(`/data/${paperJarName}`);
    expect(env).not.toHaveProperty("VERSION");
    expect(env).not.toHaveProperty("PAPER_BUILD");
  });

  it("downloads the pinned build when no jar is seeded", () => {
    const env = basePaperEnv("download");
    expect(env["TYPE"]).toBe("PAPER");
    expect(env["VERSION"]).toBe(paper.version);
    expect(env["PAPER_BUILD"]).toBe(paper.build.toString());
    expect(env).not.toHaveProperty("CUSTOM_SERVER");
  });

  it("keeps the shared settings for both sources", () => {
    for (const env of [basePaperEnv("seeded"), basePaperEnv("download")]) {
      expect(env["EULA"]).toBe("TRUE");
      expect(env["ONLINE_MODE"]).toBe("FALSE");
      expect(env["SKIP_DOWNLOAD_DEFAULTS"]).toBe("true");
    }
  });
});
