import { expect, test } from "vitest";
import { getGlitterLauncherReleaseRuleGroups } from "./glitter-boys-launcher.ts";

test("unpublished metadata creates no expiry alerts; malformed metadata fails synthesis", () => {
  expect(
    getGlitterLauncherReleaseRuleGroups({ schema: 1, release: null }),
  ).toEqual([]);
  expect(() =>
    getGlitterLauncherReleaseRuleGroups({ schema: 1, release: {} }),
  ).toThrow();
});

test("publication and renewal change the alert deadline without a telemetry service", () => {
  const record = {
    schema: 1,
    release: {
      version: "0.1.7",
      expires: 1_800_000_000,
      installer: {
        url: "https://glitter-boys.com/launcher/releases/0.1.7/glitter-boys_0.1.7_x64-setup.exe",
        bytes: 123,
        sha256: "a".repeat(64),
      },
    },
  };
  const [warning, critical] = getGlitterLauncherReleaseRuleGroups(
    record,
  ).flatMap((group) => group.rules ?? []);
  expect(String(warning?.expr?.value)).toBe(
    "(vector(1800000000) - time()) < 14 * 86400 and (vector(1800000000) - time()) > 3 * 86400",
  );
  expect(String(critical?.expr?.value)).toBe(
    "(vector(1800000000) - time()) <= 3 * 86400",
  );
  expect(warning?.labels?.["severity"]).toBe("warning");
  expect(critical?.labels?.["severity"]).toBe("critical");
  const renewed = getGlitterLauncherReleaseRuleGroups({
    ...record,
    release: { ...record.release, expires: 1_807_776_000 },
  });
  expect(JSON.stringify(renewed)).toContain("1807776000");
  expect(JSON.stringify(renewed)).not.toContain("1800000000");
});
