import { describe, expect, it } from "bun:test";
import {
  HA_CUSTOM_COMPONENTS,
  buildHaCustomComponentInstallScript,
} from "./ha-custom-components.ts";

function componentByRepo(repo: string) {
  const component = HA_CUSTOM_COMPONENTS.find(
    (candidate) => candidate.repo === repo,
  );
  if (component === undefined) {
    throw new Error(`Missing test component ${repo}`);
  }
  return component;
}

describe("buildHaCustomComponentInstallScript", () => {
  it.each(["basnijholt/adaptive-lighting", "elax46/custom-brand-icons"])(
    "hardens the generated download for %s",
    async (repo) => {
      const script = await buildHaCustomComponentInstallScript(
        componentByRepo(repo),
      );

      expect(script).toContain(
        `https://codeload.github.com/${repo}/tar.gz/refs/tags/$VERSION`,
      );
      expect(script).toContain(
        "curl -fSL --connect-timeout 15 --max-time 30 --retry 3",
      );
      expect(script).toContain(
        "--retry-connrefused --retry-delay 2 --retry-max-time 90",
      );
      expect(script).not.toContain("github.com/" + repo + "/archive/");

      const downloadIndex = script.indexOf("curl -fSL");
      const checksumIndex = script.indexOf("sha256sum -c -");
      const extractionIndex = script.indexOf("tar -xz");
      expect(downloadIndex).toBeGreaterThan(-1);
      expect(checksumIndex).toBeGreaterThan(downloadIndex);
      expect(extractionIndex).toBeGreaterThan(checksumIndex);
    },
  );
});
