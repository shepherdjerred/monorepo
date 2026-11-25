import {
  getOverview,
  getProject,
  getProjects,
  getReleases,
} from "#lib/errors/client.ts";
import type { ErrorsRequestOptions } from "#lib/errors/http.ts";
import type {
  OverviewResponse,
  ProjectSummary,
  ReleaseItem,
} from "#lib/errors/schemas.ts";
import { formatJson } from "#lib/output/formatter.ts";

export type ReadCommandOptions = ErrorsRequestOptions & {
  readonly json?: boolean | undefined;
};

function formatOverviewMarkdown(overview: OverviewResponse): string {
  const lines: string[] = [];
  lines.push("## Errors Overview");
  lines.push("");
  if (overview.viewer.login !== null) {
    lines.push(`- **Viewer:** ${overview.viewer.login}`);
  }
  lines.push(`- **Unresolved issues:** ${String(overview.totalUnresolved)}`);
  lines.push(`- **Regressed issues:** ${String(overview.totalRegressed)}`);
  lines.push(`- **Active issues (7d):** ${String(overview.activeIssues7d)}`);
  lines.push(`- **Events (24h):** ${String(overview.events24h)}`);
  lines.push(
    `- **Total events:** ${String(overview.totalDigestedEvents)} digested, ${String(overview.totalStoredEvents)} stored`,
  );
  lines.push(`- **Projects:** ${String(overview.projects.length)}`);

  if (overview.attentionIssues.length > 0) {
    lines.push("");
    lines.push(
      `### Attention Issues (${String(overview.attentionIssues.length)})`,
    );
    lines.push("");
    for (const issue of overview.attentionIssues) {
      lines.push(
        `- **${issue.type}**: ${issue.value} (\`${issue.projectSlug}\`, ${issue.state}, ${String(issue.digestedEventCount)} events, id: \`${issue.id}\`)`,
      );
    }
  }
  return lines.join("\n");
}

function formatProjectsMarkdown(projects: readonly ProjectSummary[]): string {
  const lines: string[] = [];
  lines.push("## Errors Projects");
  lines.push("");
  if (projects.length === 0) {
    lines.push("No projects found.");
    return lines.join("\n");
  }
  for (const project of projects) {
    lines.push(
      `- **${project.name}** (\`${project.slug}\`, id: ${String(project.id)})`,
    );
    lines.push(
      `  - Unresolved: ${String(project.unresolvedCount)} | Regressed: ${String(project.regressedCount)} | Muted: ${String(project.mutedCount)} | Active 7d: ${String(project.activeIssues7d)}`,
    );
    lines.push(
      `  - Events: ${String(project.digestedEventCount)} digested, ${String(project.storedEventCount)} stored`,
    );
  }
  return lines.join("\n");
}

function formatProjectDetailMarkdown(project: ProjectSummary): string {
  const lines: string[] = [];
  lines.push(`## Project: ${project.name}`);
  lines.push("");
  lines.push(`- **ID:** ${String(project.id)}`);
  lines.push(`- **Slug:** ${project.slug}`);
  lines.push(`- **DSN:** ${project.dsn}`);
  lines.push(`- **Legacy DSN:** ${project.legacyDsn}`);
  lines.push(`- **Unresolved:** ${String(project.unresolvedCount)}`);
  lines.push(`- **Regressed:** ${String(project.regressedCount)}`);
  lines.push(`- **Muted:** ${String(project.mutedCount)}`);
  lines.push(`- **Active issues (7d):** ${String(project.activeIssues7d)}`);
  lines.push(
    `- **Events:** ${String(project.digestedEventCount)} digested, ${String(project.storedEventCount)} stored (retention max: ${String(project.retentionMaxEvents)})`,
  );
  lines.push(
    `- **Alerts:** new=${String(project.alertOnNewIssue)}, regression=${String(project.alertOnRegression)}`,
  );
  lines.push("");
  lines.push("To list issues for this project:");
  lines.push("```bash");
  lines.push(`toolkit errors issues --project ${project.slug}`);
  lines.push("```");
  return lines.join("\n");
}

function formatReleasesMarkdown(releases: readonly ReleaseItem[]): string {
  const lines: string[] = [];
  lines.push("## Errors Releases");
  lines.push("");
  if (releases.length === 0) {
    lines.push("No releases found.");
    return lines.join("\n");
  }
  for (const release of releases) {
    lines.push(
      `- **${release.version}** (\`${release.projectSlug}\`, id: \`${release.id}\`, released: ${release.releasedAt})`,
    );
  }
  return lines.join("\n");
}

export async function overviewCommand(
  options: ReadCommandOptions = {},
): Promise<void> {
  const overview = await getOverview({ baseUrl: options.baseUrl });
  console.log(
    options.json === true
      ? formatJson(overview)
      : formatOverviewMarkdown(overview),
  );
}

export async function projectsCommand(
  options: ReadCommandOptions = {},
): Promise<void> {
  const projects = await getProjects({ baseUrl: options.baseUrl });
  console.log(
    options.json === true
      ? formatJson(projects)
      : formatProjectsMarkdown(projects),
  );
}

export async function projectCommand(
  idOrSlug: string,
  options: ReadCommandOptions = {},
): Promise<void> {
  const project = await getProject(idOrSlug, { baseUrl: options.baseUrl });
  console.log(
    options.json === true
      ? formatJson(project)
      : formatProjectDetailMarkdown(project),
  );
}

export async function releasesCommand(
  options: ReadCommandOptions & { readonly project?: string | undefined } = {},
): Promise<void> {
  const releases = await getReleases(options.project, {
    baseUrl: options.baseUrl,
  });
  console.log(
    options.json === true
      ? formatJson(releases)
      : formatReleasesMarkdown(releases),
  );
}
