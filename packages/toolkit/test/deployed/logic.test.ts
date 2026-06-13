import { test, expect, describe } from "bun:test";
import { isBumpSubject } from "#lib/deployed/git.ts";
import { podsForVersionKey } from "#lib/deployed/kubectl.ts";
import type { RunningPod } from "#lib/deployed/types.ts";

describe("isBumpSubject (NO_IMAGE / seed detection)", () => {
  test("true for version-bump commits", () => {
    expect(isBumpSubject("chore: bump image versions to 2.0.0-3637")).toBe(
      true,
    );
  });

  test("false for hand-written / feature commits (seed digest)", () => {
    expect(
      isBumpSubject("feat(streambot): build first-party image + move deploy"),
    ).toBe(false);
    expect(isBumpSubject("fix(homelab): clarify streambot image config")).toBe(
      false,
    );
  });
});

const pod = (
  image: string,
  imageID: string,
  digest: string | null,
): RunningPod => ({
  namespace: "ns",
  pod: "p",
  container: "c",
  image,
  imageID,
  digest,
});

describe("podsForVersionKey (imageID matching, gotcha #5/#6)", () => {
  test("matches when repo path is only in imageID (bare config sha in .image)", () => {
    const pods = [
      pod(
        "sha256:3d11a728",
        "ghcr.io/shepherdjerred/birmel@sha256:7b7dcd2c",
        "sha256:7b7dcd2c",
      ),
      pod(
        "docker.io/tailscale/tailscale:v1.96.5",
        "docker.io/tailscale/tailscale@sha256:dead",
        "sha256:dead",
      ),
    ];
    const matched = podsForVersionKey(pods, "shepherdjerred/birmel");
    expect(matched.length).toBe(1);
    expect(matched[0]?.digest).toBe("sha256:7b7dcd2c");
  });

  test("ignores the /beta|/prod variant suffix when matching the image path", () => {
    const pods = [
      pod(
        "ghcr.io/shepherdjerred/scout-for-lol:2.0.0-3637",
        "ghcr.io/shepherdjerred/scout-for-lol@sha256:d654e238",
        "sha256:d654e238",
      ),
    ];
    expect(
      podsForVersionKey(pods, "shepherdjerred/scout-for-lol/beta").length,
    ).toBe(1);
    expect(
      podsForVersionKey(pods, "shepherdjerred/scout-for-lol/prod").length,
    ).toBe(1);
  });
});
