import { Octokit } from "octokit";
import type {
  CodeReviewCommitStatusState,
  OpenMainPrRef,
  PullRequestMetadata,
} from "./code-review-types.ts";

export function defaultGetReviewToken(): string | undefined {
  return Bun.env["GITHUB_REVIEW_TOKEN"];
}

export async function defaultGetPullRequest(
  token: string,
  params: { owner: string; repo: string; prNumber: number },
): Promise<PullRequestMetadata> {
  const octokit = new Octokit({ auth: token });
  const { data } = await octokit.rest.pulls.get({
    owner: params.owner,
    repo: params.repo,
    pull_number: params.prNumber,
  });
  return {
    state: data.state === "open" ? "open" : "closed",
    draft: data.draft === true,
    baseRef: data.base.ref,
    headSha: data.head.sha,
    author: {
      login: data.user.login,
      type: data.user.type,
    },
  };
}

export async function defaultListOpenMainPrs(
  token: string,
  params: { owner: string; repo: string },
): Promise<OpenMainPrRef[]> {
  const octokit = new Octokit({ auth: token });
  const pulls = await octokit.paginate(octokit.rest.pulls.list, {
    owner: params.owner,
    repo: params.repo,
    state: "open",
    base: "main",
    per_page: 100,
  });
  return pulls
    .filter((pr) => pr.draft !== true && pr.base.ref === "main")
    .map((pr) => ({
      prNumber: pr.number,
      headSha: pr.head.sha,
      baseRef: pr.base.ref,
    }));
}

export async function defaultCreateCommitStatus(
  token: string,
  params: {
    owner: string;
    repo: string;
    sha: string;
    context: string;
    state: CodeReviewCommitStatusState;
    description: string;
    targetUrl?: string | undefined;
  },
): Promise<void> {
  const octokit = new Octokit({ auth: token });
  await octokit.rest.repos.createCommitStatus({
    owner: params.owner,
    repo: params.repo,
    sha: params.sha,
    context: params.context,
    state: params.state,
    description: params.description,
    ...(params.targetUrl === undefined ? {} : { target_url: params.targetUrl }),
  });
}
