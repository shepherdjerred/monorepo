import { z } from "zod";

import {
  FeedbackSchema,
  PrHealthSchema,
  type Feedback,
  type PrHealth,
  type ReviewFindingRef,
} from "#src/domain/schemas.ts";
import { requireSuccess, type CommandRunner } from "#src/runtime/process.ts";
import { mergeWithGitSpice } from "#src/integrations/github-merge.ts";

const PullRequestSchema = z.object({
  number: z.number().int().positive(),
  url: z.url(),
  headRefOid: z.string().min(1),
  isDraft: z.boolean(),
  mergedAt: z.string().nullable(),
  baseRefName: z.string().min(1),
  headRefName: z.string().min(1),
  mergeCommit: z.object({ oid: z.string().regex(/^[0-9a-f]{40}$/) }).nullable(),
  author: z.object({ login: z.string(), is_bot: z.boolean() }),
});
export type PullRequest = z.infer<typeof PullRequestSchema>;
export type GitHubIdentity = Readonly<{
  approver: Readonly<{ login: string; id: number }>;
  expectedBotLogin: string;
}>;

const ApiAuthorSchema = z.object({ id: z.number().int(), login: z.string() });
const CommentSchema = z.object({
  id: z.number().int(),
  body: z.string().nullable(),
  created_at: z.string(),
  html_url: z.url().nullable(),
  user: ApiAuthorSchema,
});
const ReviewSchema = z.object({
  id: z.number().int(),
  body: z.string().nullable(),
  state: z.string(),
  submitted_at: z.string().nullable(),
  html_url: z.url().nullable(),
  commit_id: z.string().nullable(),
  user: ApiAuthorSchema,
});
const FindingsSchema = z.object({
  head: z.string().min(1).optional(),
  blockedReason: z.string().nullable().optional(),
  findings: z.array(
    z.object({
      key: z.string().min(1),
      isResolved: z.boolean(),
    }),
  ),
});

function isApprover(
  author: z.infer<typeof ApiAuthorSchema>,
  login: string,
  id: number,
): boolean {
  return author.id === id && author.login.toLowerCase() === login.toLowerCase();
}

export class GitHubClient {
  public constructor(
    private readonly repository: string,
    private readonly identity: GitHubIdentity,
    private readonly run: CommandRunner,
    private readonly env: Readonly<Record<string, string>>,
  ) {}

  private verifyPullRequest(pr: PullRequest): PullRequest {
    const expectedLogin = this.identity.expectedBotLogin;
    // gh serializes GraphQL Bot actors as app/<slug>; REST uses <slug>[bot].
    const appLogin = expectedLogin.endsWith("[bot]")
      ? `app/${expectedLogin.slice(0, -"[bot]".length)}`
      : undefined;
    if (
      !pr.author.is_bot ||
      (pr.author.login !== expectedLogin && pr.author.login !== appLogin)
    ) {
      throw new Error(
        `Refusing PR #${String(pr.number)}: author ${pr.author.login} is not ${this.identity.expectedBotLogin}`,
      );
    }
    return pr;
  }

  private async command(
    args: readonly string[],
    cwd?: string,
    executable = "gh",
  ): Promise<string> {
    return requireSuccess(
      "GitHub command",
      await this.run([executable, ...args], {
        ...(cwd === undefined ? {} : { cwd }),
        env: this.env,
      }),
    ).stdout;
  }

  private async api(path: string): Promise<unknown> {
    const pages = z
      .array(z.array(z.unknown()))
      .parse(
        JSON.parse(
          await this.command([
            "api",
            `repos/${this.repository}/${path}`,
            "--paginate",
            "--slurp",
          ]),
        ),
      );
    return pages.flat();
  }

  public async pullRequest(number: number): Promise<PullRequest> {
    return this.verifyPullRequest(
      PullRequestSchema.parse(
        JSON.parse(
          await this.command([
            "pr",
            "view",
            String(number),
            "--repo",
            this.repository,
            "--json",
            "number,url,headRefOid,isDraft,mergedAt,author,baseRefName,headRefName,mergeCommit",
          ]),
        ),
      ),
    );
  }

  public async pullRequestForBranch(
    branch: string,
  ): Promise<PullRequest | null> {
    const values = z
      .array(PullRequestSchema)
      .parse(
        JSON.parse(
          await this.command([
            "pr",
            "list",
            "--repo",
            this.repository,
            "--head",
            branch,
            "--state",
            "open",
            "--json",
            "number,url,headRefOid,isDraft,mergedAt,author,baseRefName,headRefName,mergeCommit",
          ]),
        ),
      );
    const value = values[0];
    return value === undefined ? null : this.verifyPullRequest(value);
  }

  public async health(number: number, checkout: string): Promise<PrHealth> {
    const result = await this.run(
      ["toolkit", "pr", "health", String(number), "--json"],
      { cwd: checkout, env: this.env },
    );
    if (result.stdout.trim() === "") {
      requireSuccess("PR health", result);
    }
    return PrHealthSchema.parse(JSON.parse(result.stdout));
  }

  public async failureDiagnostics(
    number: number,
    health: PrHealth,
    checkout: string,
  ): Promise<string> {
    const sections = [`PR health:\n${JSON.stringify(health, null, 2)}`];
    const review = await this.run(
      [
        "toolkit",
        "pr",
        "review",
        "list",
        String(number),
        "--provider",
        "codex",
        "--json",
      ],
      { cwd: checkout, env: this.env },
    );
    sections.push(
      `Codex findings:\n${(review.stdout || review.stderr).slice(-40_000)}`,
    );
    const commands = health.checks.flatMap(
      ({ commands: values }) => values ?? [],
    );
    for (const command of commands) {
      // Match Toolkit's exact failure format before constructing subprocess args.
      const match =
        /^toolkit woodpecker pipeline log show (?<repo>[\w.-]+\/[\w.-]+) (?<pipeline>\d+)$/u.exec(
          command,
        );
      const repo = match?.groups?.["repo"];
      const pipeline = match?.groups?.["pipeline"];
      if (repo === undefined || pipeline === undefined) continue;
      const log = await this.run(
        ["toolkit", "woodpecker", "pipeline", "log", "show", repo, pipeline],
        { cwd: checkout, env: this.env },
      );
      sections.push(
        `CI pipeline ${pipeline}:\n${(log.stdout || log.stderr).slice(-60_000)}`,
      );
    }
    return sections.join("\n\n").slice(-100_000);
  }

  public async reviewDiagnostics(
    number: number,
    checkout: string,
    expectedHead: string,
  ): Promise<{
    text: string;
    findings: ReviewFindingRef[];
    blockedReasons: string[];
  }> {
    const findings: ReviewFindingRef[] = [];
    const blockedReasons: string[] = [];
    const text: string[] = [];
    for (const provider of ["codex", "coderabbit"] as const) {
      const result = requireSuccess(
        "Read provider findings",
        await this.run(
          [
            "toolkit",
            "pr",
            "review",
            "list",
            String(number),
            "--provider",
            provider,
            "--json",
          ],
          { cwd: checkout, env: this.env },
        ),
      );
      const data = FindingsSchema.parse(JSON.parse(result.stdout));
      if (data.head !== expectedHead)
        throw new Error("Review diagnostics do not match the observed PR head");
      text.push(`${provider}:\n${result.stdout.slice(-40_000)}`);
      findings.push(
        ...data.findings
          .filter((finding) => !finding.isResolved)
          .map((finding) => ({ provider, key: finding.key })),
      );
      if (data.blockedReason !== undefined && data.blockedReason !== null)
        blockedReasons.push(`${provider}: ${data.blockedReason}`);
    }
    return { text: text.join("\n\n"), findings, blockedReasons };
  }

  public async resolveFindings(
    number: number,
    evidence: string,
    checkout: string,
    requested: readonly ReviewFindingRef[],
  ): Promise<ReviewFindingRef[]> {
    const resolved: ReviewFindingRef[] = [];
    for (const provider of ["codex", "coderabbit"] as const) {
      const keys = requested
        .filter((ref) => ref.provider === provider)
        .map((ref) => ref.key);
      if (keys.length === 0) continue;
      const result = requireSuccess(
        "List addressed review findings",
        await this.run(
          [
            "toolkit",
            "pr",
            "review",
            "list",
            String(number),
            "--provider",
            provider,
            "--json",
          ],
          { cwd: checkout, env: this.env },
        ),
      );
      for (const finding of FindingsSchema.parse(JSON.parse(result.stdout))
        .findings) {
        if (finding.isResolved || !keys.includes(finding.key)) continue;
        requireSuccess(
          "Resolve addressed review finding",
          await this.run(
            [
              "toolkit",
              "pr",
              "review",
              "resolve",
              String(number),
              "--provider",
              provider,
              "--finding",
              finding.key,
              "--evidence",
              evidence,
            ],
            { cwd: checkout, env: this.env },
          ),
        );
        resolved.push({ provider, key: finding.key });
      }
    }
    return resolved;
  }

  public async feedback(
    number: number,
    seen: ReadonlySet<string>,
  ): Promise<Feedback[]> {
    const [issueComments, reviews, inlineComments] = await Promise.all([
      this.api(`issues/${String(number)}/comments`),
      this.api(`pulls/${String(number)}/reviews`),
      this.api(`pulls/${String(number)}/comments`),
    ]);
    const feedback: Feedback[] = [];
    for (const [source, values] of [
      ["issue_comment", z.array(CommentSchema).parse(issueComments)],
      ["inline_comment", z.array(CommentSchema).parse(inlineComments)],
    ] as const) {
      for (const comment of values) {
        const id = `${source}:${String(comment.id)}`;
        if (
          !seen.has(id) &&
          isApprover(
            comment.user,
            this.identity.approver.login,
            this.identity.approver.id,
          ) &&
          (comment.body ?? "").trim() !== ""
        ) {
          feedback.push(
            FeedbackSchema.parse({
              id,
              source,
              body: comment.body,
              createdAt: comment.created_at,
              url: comment.html_url,
            }),
          );
        }
      }
    }
    for (const review of z.array(ReviewSchema).parse(reviews)) {
      const id = `review:${String(review.id)}`;
      if (
        !seen.has(id) &&
        review.state !== "APPROVED" &&
        isApprover(
          review.user,
          this.identity.approver.login,
          this.identity.approver.id,
        ) &&
        (review.body ?? "").trim() !== "" &&
        review.submitted_at !== null
      ) {
        feedback.push(
          FeedbackSchema.parse({
            id,
            source: "review",
            body: review.body,
            createdAt: review.submitted_at,
            url: review.html_url,
          }),
        );
      }
    }
    return feedback.sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    );
  }

  public async hasExactHeadApproval(
    number: number,
    headSha: string,
  ): Promise<boolean> {
    const reviews = z
      .array(ReviewSchema)
      .parse(await this.api(`pulls/${String(number)}/reviews`));
    const mine = reviews
      .filter((review) =>
        isApprover(
          review.user,
          this.identity.approver.login,
          this.identity.approver.id,
        ),
      )
      .filter((review) =>
        ["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state),
      )
      .filter((review) => review.submitted_at !== null)
      .sort((left, right) =>
        (right.submitted_at ?? "").localeCompare(left.submitted_at ?? ""),
      );
    const latest = mine[0];
    return latest?.state === "APPROVED" && latest.commit_id === headSha;
  }

  public async markReady(number: number): Promise<void> {
    await this.command([
      "pr",
      "ready",
      String(number),
      "--repo",
      this.repository,
    ]);
  }

  public async updateBody(number: number, body: string): Promise<void> {
    await this.command([
      "api",
      `repos/${this.repository}/pulls/${String(number)}`,
      "--method",
      "PATCH",
      "--raw-field",
      `body=${body}`,
      "--silent",
    ]);
  }

  public async merge(
    number: number,
    headSha: string,
    input: {
      checkout: string;
      branch: string;
      readyCommand: readonly string[];
    },
  ): Promise<PullRequest> {
    return await mergeWithGitSpice(number, headSha, {
      ...input,
      repository: this.repository,
      env: this.env,
      run: this.run,
      pullRequest: this.pullRequest.bind(this),
      command: this.command.bind(this),
    });
  }
}
