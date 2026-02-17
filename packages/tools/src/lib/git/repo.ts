import { $ } from "bun";

export type RepoInfo = {
  owner: string;
  name: string;
  fullName: string;
};

export async function getCurrentBranch(): Promise<string | null> {
  try {
    const result = await $`git rev-parse --abbrev-ref HEAD`.quiet();
    return result.stdout.toString().trim();
  } catch {
    return null;
  }
}

export async function getRepoFromRemote(): Promise<RepoInfo | null> {
  try {
    const result = await $`git remote get-url origin`.quiet();
    const url = result.stdout.toString().trim();

    // Handle SSH URLs: git@github.com:owner/repo.git
    const sshMatch = /git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/.exec(url);
    if (sshMatch?.[1] && sshMatch[2]) {
      return {
        owner: sshMatch[1],
        name: sshMatch[2],
        fullName: `${sshMatch[1]}/${sshMatch[2]}`,
      };
    }

    // Handle HTTPS URLs: https://github.com/owner/repo.git
    const httpsMatch = /https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/.exec(
      url,
    );
    if (httpsMatch?.[1] && httpsMatch[2]) {
      return {
        owner: httpsMatch[1],
        name: httpsMatch[2],
        fullName: `${httpsMatch[1]}/${httpsMatch[2]}`,
      };
    }

    return null;
  } catch {
    return null;
  }
}

export async function getDefaultBranch(): Promise<string> {
  try {
    const result =
      await $`git symbolic-ref refs/remotes/origin/HEAD --short`.quiet();
    const ref = result.stdout.toString().trim();
    // Remove "origin/" prefix
    return ref.replace(/^origin\//, "");
  } catch {
    // Fall back to common defaults
    return "main";
  }
}
