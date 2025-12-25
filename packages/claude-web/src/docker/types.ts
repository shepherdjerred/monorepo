export interface ContainerConfig {
  sessionId: string;
  userId: string;
  repoUrl: string;
  baseBranch: string; // Branch to base work on (e.g., main)
  branch: string;     // Working branch (auto-generated)
  githubToken: string;
  userName: string;
  userEmail: string;
}

export type ContainerStatus = "pending" | "starting" | "running" | "stopped" | "error";

export interface ContainerInfo {
  id: string;
  name: string;
  status: ContainerStatus;
  createdAt: Date;
}
