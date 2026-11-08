import type { CiImages } from "#src/images.ts";
import type { CiStep } from "#src/pipeline/model.ts";
import { MEDIUM_TIER } from "#src/pipeline/tiers.ts";
import { GLOBAL_SELECTOR_INPUTS } from "#src/pipeline/inputs.ts";

/** Real credentialless PMS wire acceptance on the native amd64 Kubernetes CI node. */
export function mediaPmsSteps(images: CiImages): CiStep[] {
  const image = images.catalog["plexinc/pms-docker"];
  if (
    !/^plexinc\/pms-docker:[a-zA-Z0-9.-]+-amd64@sha256:[a-f0-9]{64}$/u.test(
      image,
    )
  )
    throw new Error(
      "PMS acceptance requires the exact catalogued amd64 image digest",
    );
  return [
    {
      key: "media-pms-wire",
      label: "Media pinned PMS scanner, editions and TV wire",
      image: images.base,
      commands: [
        'test "$(uname -m)" = x86_64',
        "MISE_TOOLCHAIN_SCOPE=runtime . ci/scripts/toolchain.sh",
        "ci/scripts/bun-install.sh --frozen-lockfile --filter '@shepherdjerred/media'",
        `bun --no-install packages/media/e2e/pms/prepare.ts packages/media/.cache/pms-wire '${image}'`,
        "bun --no-install build --compile --target=bun-linux-x64 packages/media/e2e/pms/run.ts --outfile packages/media/.cache/pms-wire/harness",
      ],
      resources: MEDIUM_TIER,
      timeoutMinutes: 5,
      concurrency: { limit: 1, group: "media-pms-wire" },
      // The same workflow workspace carries only generated input and the compiled test.
      // No secret grants, production PVC, host port or remote authentication exception.
      orderedSteps: [
        {
          key: "media-pms-native",
          image,
          commands: [
            'test "$(uname -m)" = x86_64',
            "packages/media/.cache/pms-wire/harness packages/media/.cache/pms-wire",
          ],
          timeoutMinutes: 5,
          resources: {
            cpuRequest: "1",
            cpuLimit: "2",
            memoryRequest: "2Gi",
            memoryLimit: "4Gi",
            ephemeralStorageRequest: "1Gi",
            ephemeralStorageLimit: "4Gi",
          },
        },
      ],
      changed: {
        include: [
          ...GLOBAL_SELECTOR_INPUTS,
          "packages/media/**",
          "packages/version-catalog/src/catalog.json",
          "ci/ci-image/**",
          "ci/scripts/bun-install.sh",
          "ci/scripts/toolchain.sh",
          ".mise.toml",
          "mise.lock",
          "bun.lock",
          "bunfig.toml",
          "package.json",
        ],
      },
    },
  ];
}
