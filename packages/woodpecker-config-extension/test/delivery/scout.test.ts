import { chmod, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { scoutSteps } from "#src/pipeline/lanes/scout.ts";

const imageA = `sha256:${"a".repeat(64)}`;
const imageB = `sha256:${"b".repeat(64)}`;
const images = {
  base: "base",
  playwright: "browser",
  catalog: {
    "aquasec/trivy": "trivy",
    "semgrep/semgrep": "semgrep",
    "texlive/texlive": "texlive",
    "trmnl/trmnlp": "trmnl",
    "grafana/tempo": "tempo",
    "mikefarah/yq": "yq",
    "minio/mc": "mc",
    "minio/minio": "minio",
  },
};

// Execute the emitted Scout delivery shell with local, credentialless effects.
const effects = String.raw`
bun() {
  while [[ "$1" == --* ]]; do shift; done
  local program="$1"; shift
  case "$program" in
    scripts/ci/homelab-release-admission.ts) printf admitted ;;
    scripts/ci/read-ci-handoff.ts)
      case "$1" in
        image-digests|version-catalog) printf '{}' ;;
        delivery-image-digests)
          if [[ "$FRESH_IMAGE" == true ]]; then printf '{"shepherdjerred/scout-for-lol":"%s"}' "$IMAGE_B"; else printf '{}'; fi ;;
        *) return 1 ;;
      esac ;;
    ci/scripts/selectors/ci-changed.ts) [[ "$SITE_CHANGED" == true ]] ;;
    ci/scripts/reporting/dockerhub-env.ts|run) return 0 ;;
    scripts/release/resolve-scout-delivery-backend.ts) printf '%s' "$IMAGE_B" ;;
    scripts/release/static-site-writer.ts) printf legacy ;;
    scripts/ci/write-ci-handoff.ts) cat > "$1.json" ;;
    scripts/release/scout-site-release.ts)
      local command="$1"; shift
      case "$command" in
        resolve-backend-digest) printf '%s' "$IMAGE_A" ;;
        prepare-state)
          local output='' digest=''
          while [[ $# -gt 0 ]]; do
            case "$1" in
              --output) output="$2"; shift ;;
              --backend-digest) digest="$2"; shift ;;
            esac
            shift
          done
          mkdir -p "$(dirname "$output")"
          printf '{"backend":"%s"}' "$digest" > "$output"
          printf 'prepare:%s:%s\n' "$output" "$digest" >> actions ;;
        archive|deploy-beta) printf '%s\n' "$command" >> actions ;;
        *) return 1 ;;
      esac ;;
    scripts/release/publish-scout-site-archives.ts) printf 'publish:%s\n' "$(cat "$1")" >> actions ;;
    *) return 1 ;;
  esac
}
`;

test.each([
  { sourceChanged: false, freshImage: true },
  { sourceChanged: true, freshImage: true },
  { sourceChanged: true, freshImage: false },
])(
  "Scout archives keep independent image binding (source=$sourceChanged, fresh=$freshImage)",
  async ({ sourceChanged, freshImage }) => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "scout-delivery-shell-"),
    );
    try {
      await mkdir(path.join(directory, "ci/scripts"), { recursive: true });
      await Bun.write(
        path.join(directory, "ci/scripts/toolchain.sh"),
        "# fixture\n",
      );
      await Bun.write(
        path.join(directory, "ci/scripts/bun-install.sh"),
        "#!/bin/sh\nexit 0\n",
      );
      await chmod(path.join(directory, "ci/scripts/bun-install.sh"), 0o755);
      const step = scoutSteps(images).find(
        (entry) => entry.key === "scout-site-archives",
      );
      if (step === undefined) throw new Error("Missing Scout release step");
      const child = Bun.spawn(
        [
          "bash",
          "-c",
          ["set -euo pipefail", effects, ...step.commands].join("\n"),
        ],
        {
          cwd: directory,
          env: {
            PATH: Bun.env["PATH"],
            SITE_CHANGED: String(sourceChanged),
            FRESH_IMAGE: String(freshImage),
            IMAGE_A: imageA,
            IMAGE_B: imageB,
            CI_RELEASE_NUMBER: "42",
            SEAWEEDFS_SITES_ACCESS_KEY_ID: "fixture",
            SEAWEEDFS_SITES_SECRET_ACCESS_KEY: "fixture",
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [code, stderr] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
      ]);
      expect(code, stderr).toBe(0);
      const actions = await Bun.file(path.join(directory, "actions")).text();
      expect(actions).toContain(
        `prepare:.delivery-artifacts/scout-release/state.json:${imageB}`,
      );
      expect(actions).toContain(`publish:{"backend":"${imageB}"}`);
      const legacy = Bun.file(path.join(directory, "scout-release-state.json"));
      expect(await legacy.exists()).toBe(false);
      expect(actions).not.toContain("archive\n");
      expect(actions).not.toContain("deploy-beta\n");
      expect(actions).not.toContain("prepare:.scout-release/");
      expect(step.dependsOn).toEqual(["images"]);
      expect(
        step.secrets?.some((secret) =>
          /SEAWEEDFS_SITES|CLOUDFLARE|ARGOCD|TOFU/u.test(secret.key),
        ),
      ).toBe(false);
      expect(scoutSteps(images).map((entry) => entry.key)).toEqual([
        "scout-site-archives",
        "release-please",
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
