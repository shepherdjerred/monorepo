import { getTeams, getTeam } from "#lib/bugsink/queries.ts";
import type { BugsinkTeam } from "#lib/bugsink/types.ts";
import { formatJson } from "#lib/output/formatter.ts";

export type TeamsOptions = {
  json?: boolean | undefined;
};

export type TeamOptions = {
  json?: boolean | undefined;
};

function formatTeamsMarkdown(teams: BugsinkTeam[]): string {
  const lines: string[] = [];

  lines.push("## Bugsink Teams");
  lines.push("");

  if (teams.length === 0) {
    lines.push("No teams found.");
    return lines.join("\n");
  }

  for (const team of teams) {
    lines.push(`- **${team.name}**`);
    lines.push(`  - ID: ${team.id}`);
    lines.push(`  - Visibility: ${team.visibility}`);
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("To view team details:");
  lines.push("```bash");
  lines.push("tools bugsink team <TEAM_UUID>");
  lines.push("```");

  return lines.join("\n");
}

function formatTeamDetails(team: BugsinkTeam): string {
  const lines: string[] = [];

  lines.push(`## Team: ${team.name}`);
  lines.push("");
  lines.push("### Details");
  lines.push("");
  lines.push(`- **ID:** ${team.id}`);
  lines.push(`- **Name:** ${team.name}`);
  lines.push(`- **Visibility:** ${team.visibility}`);
  lines.push("");
  lines.push("To view projects for this team:");
  lines.push("```bash");
  lines.push(`tools bugsink projects --team ${team.id}`);
  lines.push("```");

  return lines.join("\n");
}

export async function teamsCommand(
  options: TeamsOptions = {},
): Promise<void> {
  try {
    const teams = await getTeams();

    if (options.json === true) {
      console.log(formatJson(teams));
    } else {
      console.log(formatTeamsMarkdown(teams));
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

export async function teamCommand(
  uuid: string,
  options: TeamOptions = {},
): Promise<void> {
  try {
    const team = await getTeam(uuid);

    if (team == null) {
      console.error(`Error: Team ${uuid} not found`);
      process.exit(1);
    }

    if (options.json === true) {
      console.log(formatJson(team));
    } else {
      console.log(formatTeamDetails(team));
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
