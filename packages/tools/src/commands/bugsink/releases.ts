import { getReleases, getRelease } from "#lib/bugsink/queries.ts";
import type {
  BugsinkReleaseListItem,
  BugsinkReleaseDetail,
} from "#lib/bugsink/types.ts";
import { formatJson } from "#lib/output/formatter.ts";

export type ReleasesOptions = {
  json?: boolean | undefined;
  project?: number | undefined;
};

export type ReleaseOptions = {
  json?: boolean | undefined;
};

function formatReleasesMarkdown(releases: BugsinkReleaseListItem[]): string {
  const lines: string[] = [];

  lines.push("## Bugsink Releases");
  lines.push("");

  if (releases.length === 0) {
    lines.push("No releases found.");
    return lines.join("\n");
  }

  for (const release of releases) {
    lines.push(`- **${release.version}**`);
    lines.push(`  - ID: ${release.id}`);
    lines.push(`  - Project: ${String(release.project)}`);

    if (release.date_released != null) {
      lines.push(`  - Released: ${new Date(release.date_released).toLocaleString()}`);
    }

    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("To view release details:");
  lines.push("```bash");
  lines.push("tools bugsink release <RELEASE_UUID>");
  lines.push("```");

  return lines.join("\n");
}

function formatReleaseDetails(release: BugsinkReleaseDetail): string {
  const lines: string[] = [];

  lines.push(`## Release: ${release.version}`);
  lines.push("");
  lines.push("### Details");
  lines.push("");
  lines.push(`- **ID:** ${release.id}`);
  lines.push(`- **Version:** ${release.version}`);
  lines.push(`- **Project:** ${String(release.project)}`);
  lines.push(`- **Is SemVer:** ${String(release.is_semver)}`);

  if (release.semver.length > 0) {
    lines.push(`- **SemVer:** ${release.semver}`);
  }

  lines.push(`- **Sort Epoch:** ${String(release.sort_epoch)}`);

  if (release.date_released != null) {
    lines.push(`- **Released:** ${new Date(release.date_released).toLocaleString()}`);
  }

  return lines.join("\n");
}

export async function releasesCommand(
  options: ReleasesOptions = {},
): Promise<void> {
  try {
    const releases = await getReleases(options.project);

    if (options.json === true) {
      console.log(formatJson(releases));
    } else {
      console.log(formatReleasesMarkdown(releases));
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

export async function releaseCommand(
  uuid: string,
  options: ReleaseOptions = {},
): Promise<void> {
  try {
    const release = await getRelease(uuid);

    if (release == null) {
      console.error(`Error: Release ${uuid} not found`);
      process.exit(1);
    }

    if (options.json === true) {
      console.log(formatJson(release));
    } else {
      console.log(formatReleaseDetails(release));
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
