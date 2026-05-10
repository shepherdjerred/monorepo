import { z } from "zod";

const PagedResponseSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    next: z.string().nullable().optional(),
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
    const initialUrl = new URL(`${this.baseUrl}/issues/`);
    initialUrl.searchParams.set("project", String(projectId));
    initialUrl.searchParams.set("status", "unresolved");

    let nextUrl: string | null = initialUrl.toString();
    let total = 0;
    while (nextUrl !== null) {
      const response = await this.fetchJson(new URL(nextUrl));
      const page = PagedResponseSchema(IssueSchema).parse(response);
      total += page.results.filter((issue) => !issue.is_resolved).length;
      nextUrl = page.next ?? null;
    }
    return total;
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
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      throw new Error(`Bugsink request failed: ${response.status.toString()}`);
    }
    return response.json();
  }
}
