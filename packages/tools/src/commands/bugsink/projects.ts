import { getProjects, getProject } from "#lib/bugsink/queries.ts";
import type { BugsinkProjectDetail } from "#lib/bugsink/types.ts";
import { formatJson } from "#lib/output/formatter.ts";

export type ProjectsOptions = {
  json?: boolean | undefined;
  team?: string | undefined;
};

export type ProjectOptions = {
  json?: boolean | undefined;
};

function formatProjectsMarkdown(projects: BugsinkProjectDetail[]): string {
  const lines: string[] = [];

  lines.push("## Bugsink Projects");
  lines.push("");

  if (projects.length === 0) {
    lines.push("No projects found.");
    return lines.join("\n");
  }

  for (const project of projects) {
    lines.push(`- **${project.name}** (\`${project.slug}\`)`);
    lines.push(`  - ID: ${String(project.id)}`);
    lines.push(
      `  - Events: ${String(project.digested_event_count)} digested, ${String(project.stored_event_count)} stored`,
    );
    lines.push(`  - Visibility: ${project.visibility}`);
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("To view project details:");
  lines.push("```bash");
  lines.push("tools bugsink project <PROJECT_ID>");
  lines.push("```");

  return lines.join("\n");
}

function formatProjectDetails(project: BugsinkProjectDetail): string {
  const lines: string[] = [];

  lines.push(`## Project: ${project.name}`);
  lines.push("");
  lines.push("### Details");
  lines.push("");
  lines.push(`- **ID:** ${String(project.id)}`);
  lines.push(`- **Slug:** ${project.slug}`);
  lines.push(`- **DSN:** ${project.dsn}`);
  lines.push(`- **Visibility:** ${project.visibility}`);

  if (project.team != null) {
    lines.push(`- **Team:** ${project.team}`);
  }

  lines.push("");
  lines.push("### Event Counts");
  lines.push("");
  lines.push(`- **Digested:** ${String(project.digested_event_count)}`);
  lines.push(`- **Stored:** ${String(project.stored_event_count)}`);
  lines.push("");

  lines.push("### Alert Settings");
  lines.push("");
  lines.push(`- **Alert on new issue:** ${String(project.alert_on_new_issue)}`);
  lines.push(
    `- **Alert on regression:** ${String(project.alert_on_regression)}`,
  );
  lines.push(`- **Alert on unmute:** ${String(project.alert_on_unmute)}`);
  lines.push("");

  lines.push("To view issues for this project:");
  lines.push("```bash");
  lines.push(`tools bugsink issues --project ${project.slug}`);
  lines.push("```");

  return lines.join("\n");
}

export async function projectsCommand(
  options: ProjectsOptions = {},
): Promise<void> {
  try {
    const projects = await getProjects(options.team);

    if (options.json === true) {
      console.log(formatJson(projects));
    } else {
      console.log(formatProjectsMarkdown(projects));
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

export async function projectCommand(
  id: number,
  options: ProjectOptions = {},
): Promise<void> {
  try {
    const project = await getProject(id);

    if (project == null) {
      console.error(`Error: Project ${String(id)} not found`);
      process.exit(1);
    }

    if (options.json === true) {
      console.log(formatJson(project));
    } else {
      console.log(formatProjectDetails(project));
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
