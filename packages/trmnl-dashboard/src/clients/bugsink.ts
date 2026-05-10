import { z } from "zod";

const PagedResponseSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    results: z.array(item),
  });

const ProjectSchema = z.object({
  id: z.number(),
  name: z.string(),
});

const IssueSchema = z.object({
  is_resolved: z.boolean(),
});

export type BugsinkProjectSummary = {
  name: string;
  unresolved: number;
};

export class BugsinkClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async getProjectSummaries(): Promise<BugsinkProjectSummary[]> {
    const projects = await this.fetchProjects();
    const summaries = await Promise.all(
      projects.map(async (project) => {
        const unresolved = await this.countUnresolved(project.id);
        return { name: project.name, unresolved };
      }),
    );
    return summaries.toSorted((a, b) => b.unresolved - a.unresolved);
  }

  private async fetchProjects(): Promise<z.infer<typeof ProjectSchema>[]> {
    const response = await this.fetchJson("/projects/");
    return PagedResponseSchema(ProjectSchema).parse(response).results;
  }

  private async countUnresolved(projectId: number): Promise<number> {
    const url = new URL(`${this.baseUrl}/issues/`);
    url.searchParams.set("project", String(projectId));
    const response = await this.fetchJson(url);
    const issues = PagedResponseSchema(IssueSchema).parse(response).results;
    return issues.filter((issue) => !issue.is_resolved).length;
  }

  private async fetchJson(pathOrUrl: string | URL): Promise<unknown> {
    const url =
      pathOrUrl instanceof URL
        ? pathOrUrl
        : new URL(`${this.baseUrl}${pathOrUrl}`);
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(`Bugsink request failed: ${response.status.toString()}`);
    }
    return response.json();
  }
}
