import { z } from "zod/v4";
import type {
  DependencyChange,
  ReleaseNote,
  ReleaseNoteAttempt,
} from "#shared/deps-summary-types.ts";
import { ociImageLocation, ociMetadata } from "./deps-summary-oci.ts";

const SOURCE = "https://github.com/shepherdjerred/monorepo";
class BuildEvidenceUnavailable extends Error {}
const CommitSchema = z.object({
  sha: z.string().regex(/^[a-f0-9]{40}$/),
  commit: z.object({ message: z.string().min(1) }),
});
const CompareSchema = z.object({
  status: z.enum(["ahead", "behind", "diverged", "identical"]),
  total_commits: z.number().int().nonnegative(),
  base_commit: CommitSchema,
  commits: z.array(CommitSchema),
});

async function imageRevision(
  change: DependencyChange,
  value: string | undefined,
): Promise<string> {
  const image = ociImageLocation(change, value);
  if (!image.reference.startsWith("sha256:")) {
    throw new BuildEvidenceUnavailable(
      "Internal build evidence requires an immutable image digest",
    );
  }
  const metadata = await ociMetadata(
    image.registryOrigin,
    image.repository,
    image.reference,
    { followIndex: true },
  );
  if (
    metadata.source !== SOURCE ||
    metadata.revision === undefined ||
    !/^[a-f0-9]{40}$/.test(metadata.revision)
  ) {
    throw new BuildEvidenceUnavailable(
      "Pinned image has no verified monorepo source and full build revision",
    );
  }
  return metadata.revision;
}

export async function internalBuildAttempt(
  change: DependencyChange,
  headers: Record<string, string>,
): Promise<{
  attempt: ReleaseNoteAttempt;
  note: ReleaseNote | undefined;
}> {
  let url: string | undefined;
  try {
    const revision = await imageRevision(change, change.newValue);
    const previous =
      change.oldValue === undefined
        ? undefined
        : await imageRevision(change, change.oldValue);
    url =
      previous === undefined
        ? `${SOURCE}/commit/${revision}`
        : `${SOURCE}/compare/${previous}...${revision}`;
    const apiUrl =
      previous === undefined
        ? `https://api.github.com/repos/shepherdjerred/monorepo/commits/${revision}`
        : `https://api.github.com/repos/shepherdjerred/monorepo/compare/${previous}...${revision}`;
    const response = await fetch(apiUrl, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new Error(
        `Build source API returned HTTP ${response.status.toString()}`,
      );
    const payload: unknown = await response.json();
    let detail: string;
    if (previous === undefined) {
      const commit = CommitSchema.parse(payload);
      if (commit.sha !== revision)
        throw new Error("Build source commit does not match the pinned image");
      detail = `Built from ${revision}: ${commit.commit.message.split("\n")[0] ?? commit.commit.message}`;
    } else {
      const compare = CompareSchema.parse(payload);
      if (compare.base_commit.sha !== previous)
        throw new Error(
          "Build comparison base does not match the previous pinned image",
        );
      const subjects = compare.commits
        .slice(0, 10)
        .map(
          (commit) =>
            `${commit.sha.slice(0, 12)} ${commit.commit.message.split("\n")[0] ?? commit.commit.message}`,
        );
      detail = [
        `Build source moved from ${previous} to ${revision}; comparison ${compare.status}, ${compare.total_commits.toString()} source commits.`,
        ...subjects,
      ].join("\n");
    }
    return {
      attempt: {
        source: "internal-build",
        url,
        outcome: "found",
        detail:
          "Verified pinned-image build revisions against repository source",
      },
      note: {
        dependency: change.name,
        version: change.newVersion ?? "removed",
        source: "internal-build",
        url,
        notes: `Build provenance (not upstream release notes). ${detail}`,
      },
    };
  } catch (error: unknown) {
    return {
      attempt: {
        source: "internal-build",
        url,
        outcome:
          error instanceof BuildEvidenceUnavailable ? "unavailable" : "failed",
        detail: error instanceof Error ? error.message : String(error),
      },
      note: undefined,
    };
  }
}
