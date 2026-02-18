import { useState } from "react";
import { toast } from "sonner";

type RepositoryEntry = {
  id: string;
  repo_path: string;
  mount_name: string;
  is_primary: boolean;
  base_branch: string;
};

const DEFAULT_REPO: RepositoryEntry = {
  id: "1",
  repo_path: "",
  mount_name: "",
  is_primary: true,
  base_branch: "",
};

export function useRepositoryHandlers() {
  const [multiRepoEnabled, setMultiRepoEnabled] = useState(false);
  const [repositories, setRepositories] = useState<RepositoryEntry[]>([
    DEFAULT_REPO,
  ]);

  const handleRepoPathChange = (id: string, newPath: string) => {
    setRepositories((repos) =>
      repos.map((repo) =>
        repo.id === id ? { ...repo, repo_path: newPath } : repo,
      ),
    );
  };

  const handleSetPrimary = (id: string) => {
    setRepositories((repos) =>
      repos.map((repo) => ({
        ...repo,
        is_primary: repo.id === id,
      })),
    );
  };

  const handleMountNameChange = (id: string, newName: string) => {
    setRepositories((repos) =>
      repos.map((repo) =>
        repo.id === id ? { ...repo, mount_name: newName } : repo,
      ),
    );
  };

  const handleBaseBranchChange = (id: string, newBaseBranch: string) => {
    setRepositories((repos) =>
      repos.map((repo) =>
        repo.id === id ? { ...repo, base_branch: newBaseBranch } : repo,
      ),
    );
  };

  const handleAddRepository = () => {
    if (repositories.length >= 5) {
      toast.error("Maximum 5 repositories per session");
      return;
    }

    const newId = String(Date.now());
    setRepositories([
      ...repositories,
      {
        id: newId,
        repo_path: "",
        mount_name: "",
        is_primary: false,
        base_branch: "",
      },
    ]);
  };

  const handleRemoveRepository = (id: string) => {
    if (repositories.length === 1) {
      toast.error("Must have at least one repository");
      return;
    }

    const repoToRemove = repositories.find((r) => r.id === id);
    const newRepos = repositories.filter((r) => r.id !== id);

    if (
      repoToRemove?.is_primary === true &&
      newRepos.length > 0 &&
      newRepos[0] != null
    ) {
      newRepos[0].is_primary = true;
    }

    setRepositories(newRepos);
  };

  return {
    multiRepoEnabled,
    setMultiRepoEnabled,
    repositories,
    setRepositories,
    handleRepoPathChange,
    handleSetPrimary,
    handleMountNameChange,
    handleBaseBranchChange,
    handleAddRepository,
    handleRemoveRepository,
  };
}
