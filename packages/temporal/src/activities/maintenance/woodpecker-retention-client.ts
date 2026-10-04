import { z } from "zod/v4";
import {
  RetentionPipelineSchema,
  RetentionRepoSchema,
  type RetentionRepo,
} from "#shared/woodpecker-retention.ts";

const StepSchema = z.object({
  id: z.number().int().positive(),
  state: RetentionPipelineSchema.shape.status,
});
const DetailSchema = RetentionPipelineSchema.extend({
  workflows: z
    .array(
      z.object({
        state: RetentionPipelineSchema.shape.status,
        children: z.array(StepSchema).default([]),
      }),
    )
    .default([]),
});
const LogsSchema = z.array(
  z.object({
    data: z
      .string()
      .refine(
        (value) => Buffer.from(value, "base64").toString("base64") === value,
      )
      .nullable(),
  }),
);

export type RetentionRequest = (
  path: string,
  method?: "GET" | "DELETE",
) => Promise<unknown>;
export type RetentionReferences = {
  heads: Set<string>;
  numbers: Set<number>;
  protectAllMain: boolean;
  protectionReasons?: string[];
};
export function detailIsTerminal(
  detail: z.infer<typeof DetailSchema>,
): boolean {
  const active = new Set(["pending", "running", "blocked"]);
  return (
    !active.has(detail.status) &&
    detail.workflows.every(
      (workflow) =>
        !active.has(workflow.state) &&
        workflow.children.every((step) => !active.has(step.state)),
    )
  );
}

export class RetentionClient {
  constructor(
    readonly request: RetentionRequest,
    readonly references: (repo: RetentionRepo) => Promise<RetentionReferences>,
  ) {}

  async repos() {
    const repos: RetentionRepo[] = [];
    for (let page = 1; page <= 100; page++) {
      const items = z
        .array(RetentionRepoSchema)
        .parse(
          await this.request(`/api/repos?page=${String(page)}&perPage=100`),
        );
      repos.push(...items);
      if (items.length < 100) return repos;
    }
    throw new Error(
      "Woodpecker repository inventory exceeds pagination safety bound",
    );
  }

  async repo(id: number) {
    return RetentionRepoSchema.parse(
      await this.request(`/api/repos/${String(id)}`),
    );
  }

  async page(repo: RetentionRepo, page: number, cutoff: number) {
    if (page > 100)
      throw new Error(
        "Woodpecker pipeline inventory exceeds pagination safety bound",
      );
    const before = new Date(cutoff * 1000).toISOString();
    return z
      .array(RetentionPipelineSchema)
      .parse(
        await this.request(
          `/api/repos/${String(repo.id)}/pipelines?${new URLSearchParams({ page: String(page), perPage: "100", before }).toString()}`,
        ),
      );
  }

  async detail(repo: RetentionRepo, number: number) {
    const detail = DetailSchema.parse(
      await this.request(
        `/api/repos/${String(repo.id)}/pipelines/${String(number)}`,
      ),
    );
    if (detail.number !== number)
      throw new Error("Woodpecker pipeline identity changed");
    return detail;
  }

  async logEntries(repo: RetentionRepo, number: number) {
    const detail = await this.detail(repo, number);
    let count = 0;
    for (const workflow of detail.workflows) {
      for (const step of workflow.children) {
        // Null/empty chunks contain no retained log bytes. Never return contents.
        const logs = LogsSchema.parse(
          await this.request(
            `/api/repos/${String(repo.id)}/logs/${String(number)}/${String(step.id)}`,
          ),
        );
        count += logs.filter(
          (entry) => entry.data !== null && entry.data !== "",
        ).length;
      }
    }
    return count;
  }

  async deleteLogs(repo: RetentionRepo, number: number) {
    await this.request(
      `/api/repos/${String(repo.id)}/logs/${String(number)}`,
      "DELETE",
    );
    // v3.18.1 can return 204 despite a LogDelete error; prove the outcome.
    if ((await this.logEntries(repo, number)) !== 0)
      throw new Error("Woodpecker log deletion did not clear every step");
  }
}
